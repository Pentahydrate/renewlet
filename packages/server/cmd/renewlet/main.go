package main

// main.go 是 Renewlet 的 PocketBase 应用入口。
//
// 架构位置：
//   - 负责启动 PocketBase、注册 schema migration、record hooks、cron 和自定义 HTTP route。
//   - 静态前端由 embedded FS 提供，自定义 API 复用 PocketBase auth/session。
//   - 具体请求/响应 DTO 在 api_contracts.go，通知任务在 notifications.go，文件资产在 assets.go。
//
// 注意： 这里的 route 是前端 API schema 的后端真相来源；新增字段时必须同步 Zod schema 和 route 测试。
import (
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	appstatic "github.com/zhiyingzzhou/renewlet/packages/server/internal/static"
)

func init() {
	core.AppMigrations.Register(func(app core.App) error {
		return ensureSchema(app)
	}, nil, "20260514000000_renewlet_schema.go")
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		runHealthcheck()
		return
	}
	if len(os.Args) > 1 && (os.Args[1] == "version" || os.Args[1] == "--version") {
		fmt.Println(Version)
		return
	}

	if os.Getenv("GOMEMLIMIT") == "" {
		_ = os.Setenv("GOMEMLIMIT", "128MiB")
	}
	if err := validatePBEncryptionKeyEnv(); err != nil {
		log.Fatal(err)
	}

	app := pocketbase.New()
	if err := registerNotificationCron(app); err != nil {
		log.Fatal(err)
	}
	// Record hook 必须早于 Serve route 注册，这样 API、SDK 和管理后台写入都能共享同一套持久层校验。
	registerRecordHooks(app)

	app.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if err := e.App.RunAppMigrations(); err != nil {
			return err
		}
		return ensureSchema(e.App)
	})

	registerAuthHooks(app)

	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Func: func(e *core.ServeEvent) error {
			disablePocketBaseInstaller(e)
			registerRoutes(e.App, e.Router)

			staticFS, err := fs.Sub(appstatic.Files, "public")
			if err != nil {
				return err
			}
			if !e.Router.HasRoute(http.MethodGet, "/{path...}") {
				e.Router.GET("/{path...}", staticWithSecurityHeaders(staticFS))
			}

			return e.Next()
		},
		Priority: 999,
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

func registerAuthHooks(app core.App) {
	rejectBannedAuthRecord := func(request *http.Request, collection *core.Collection, record *core.Record) error {
		if collection != nil && collection.Name == "users" && record != nil && record.GetBool("banned") {
			return apis.NewUnauthorizedError(localizedDisabledBanReason(requestLocale(request)), nil)
		}
		return nil
	}
	app.OnRecordAuthWithPasswordRequest().BindFunc(func(e *core.RecordAuthWithPasswordRequestEvent) error {
		if err := rejectBannedAuthRecord(e.Request, e.Collection, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
	app.OnRecordAuthRefreshRequest().BindFunc(func(e *core.RecordAuthRefreshRequestEvent) error {
		if err := rejectBannedAuthRecord(e.Request, e.Collection, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
	app.OnRecordAuthRequest().BindFunc(func(e *core.RecordAuthRequestEvent) error {
		if err := rejectBannedAuthRecord(e.Request, e.Collection, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
}

func disablePocketBaseInstaller(e *core.ServeEvent) {
	// 首装状态机只属于 Renewlet /setup；PocketBase installer 会另开 /_/#/pbinstall，导致 E2E 和用户看到两套入口。
	e.InstallerFunc = nil
}

func runHealthcheck() {
	url := "http://127.0.0.1:3000/api/app/health"
	for _, arg := range os.Args[2:] {
		if strings.HasPrefix(arg, "--url=") {
			url = strings.TrimPrefix(arg, "--url=")
		}
	}

	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		fmt.Fprintf(os.Stderr, "healthcheck failed: %s\n", resp.Status)
		os.Exit(1)
	}
}

// staticWithSecurityHeaders 为嵌入式前端静态资源补安全响应头。
// 注意： CSP connect-src 需要覆盖前端直接访问的第三方 API；新增外部 fetch 时要同步这里。
func staticWithSecurityHeaders(staticFS fs.FS) func(*core.RequestEvent) error {
	handler := apis.Static(staticFS, true)
	return func(e *core.RequestEvent) error {
		headers := e.Response.Header()
		headers.Set("X-Content-Type-Options", "nosniff")
		headers.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		headers.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		headers.Set("Content-Security-Policy", staticContentSecurityPolicy(e.Request))
		return handler(e)
	}
}

func staticContentSecurityPolicy(request *http.Request) string {
	directives := []string{
		"default-src 'self'",
		// wasm-unsafe-eval 只给前端 Worker 内 sql.js 解析用户本地 Wallos DB；不允许后端代请求 Wallos URL。
		"script-src 'self' 'wasm-unsafe-eval'",
		"style-src 'self' 'unsafe-inline'",
		"font-src 'self' data:",
		"img-src 'self' data: blob: " + staticImageSources(request),
		"connect-src 'self' https://cdn.jsdelivr.net https://latest.currency-api.pages.dev https://www.floatrates.com",
		"object-src 'none'",
		"base-uri 'self'",
		"frame-ancestors 'none'",
	}
	if externalRequestProto(request) == "https" {
		// HTTPS 外部访问不能实际发起 HTTP 图片请求；浏览器可升级域名源，IP 源由展示 helper 直接降级为 fallback。
		directives = append(directives, "upgrade-insecure-requests")
	}
	return strings.Join(directives, "; ")
}

func staticImageSources(request *http.Request) string {
	if externalRequestProto(request) == "https" {
		return "https:"
	}
	return "http: https:"
}

func externalRequestProto(request *http.Request) string {
	if proto := forwardedProto(request.Header.Get("Forwarded")); proto != "" {
		return proto
	}
	if proto := strings.TrimSpace(request.Header.Get("X-Forwarded-Proto")); proto != "" {
		if comma := strings.Index(proto, ","); comma >= 0 {
			proto = proto[:comma]
		}
		proto = strings.ToLower(strings.TrimSpace(proto))
		if proto == "http" || proto == "https" {
			return proto
		}
	}
	if request.TLS != nil {
		return "https"
	}
	return "http"
}

func forwardedProto(value string) string {
	for _, forwardedValue := range strings.Split(value, ",") {
		for _, part := range strings.Split(forwardedValue, ";") {
			pair := strings.SplitN(strings.TrimSpace(part), "=", 2)
			if len(pair) != 2 || !strings.EqualFold(strings.TrimSpace(pair[0]), "proto") {
				continue
			}
			proto := strings.ToLower(strings.Trim(strings.TrimSpace(pair[1]), `"`))
			if proto == "http" || proto == "https" {
				return proto
			}
		}
	}
	return ""
}
