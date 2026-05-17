package main

// routes.go 集中注册 Renewlet 自定义 HTTP API。
//
// 架构位置：
//   - 公共 route 暴露 health/setup/password-reset/TheSVG 状态。
//   - 认证 route 复用 PocketBase session，并把请求体交给严格 decoder 和命名 request struct。
//   - route 返回的 response struct 是前端 Zod schema 的运行时契约。
//
// 请求流转：
//   fetch -> PocketBase auth/locale -> 严格 JSON 解码 -> Validate -> handler -> response struct
//
// 注意： 这里拒绝未知字段和多余 JSON token；新增 API 字段时必须同步前端 schema 与测试 fixture。
import (
	"errors"
	"net/http"
	"sort"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

func registerRoutes(app core.App, router *router.Router[*core.RequestEvent]) {
	// 公共状态接口不要求认证，但响应仍使用命名 struct，避免前端在登录前信任松散 JSON。
	router.GET("/api/app/health", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, newHealthResponse())
	})

	router.GET("/api/app/setup", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, setupStatusResponse{
			SetupRequired: !hasEnabledAdmin(app),
			SetupEnabled:  envBool("SETUP_ENABLED", true),
		})
	})
	router.GET("/api/cron/notifications", func(e *core.RequestEvent) error { return handleNotificationCron(app, e) })
	router.POST("/api/app/setup", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		if !envBool("SETUP_ENABLED", true) {
			return e.ForbiddenError(tr(locale, "初始化已关闭", "Setup is disabled"), nil)
		}
		if hasEnabledAdmin(app) {
			return e.ForbiddenError(tr(locale, "系统已初始化", "System has already been initialized"), nil)
		}
		// setup 是认证前入口，必须用严格 decoder 拒绝未知字段和多余 token。
		body, err := decodeStrictJSON[setupCreateRequest](e.Request, locale)
		if err != nil {
			return e.BadRequestError(validationErrorMessage(locale, "请求体无效", "Invalid request body", err), err)
		}
		if err := createInitialAdmin(app, body.Name, body.Email, body.Password); err != nil {
			if errors.Is(err, errSetupAlreadyInitialized) {
				return e.ForbiddenError(tr(locale, "系统已初始化", "System has already been initialized"), nil)
			}
			return e.BadRequestError(tr(locale, "管理员创建失败", "Failed to create admin"), err)
		}
		return e.JSON(http.StatusCreated, newOKResponse())
	})

	admin := router.Group("/api/app/admin").Bind(apis.RequireAuth("users")).BindFunc(requireAdmin)
	admin.GET("/users", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		users, err := app.FindAllRecords("users")
		if err != nil {
			return e.InternalServerError(tr(locale, "加载用户失败", "Failed to load users"), err)
		}
		sort.Slice(users, func(i, j int) bool {
			return users[i].GetDateTime("created").Time().After(users[j].GetDateTime("created").Time())
		})
		out := make([]userDTO, 0, len(users))
		for _, user := range users {
			out = append(out, toUserDTO(user))
		}
		return e.JSON(http.StatusOK, adminUsersResponse{Users: out})
	})
	admin.POST("/users", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		body, err := decodeStrictJSON[adminCreateUserRequest](e.Request, locale)
		if err != nil {
			return e.BadRequestError(validationErrorMessage(locale, "请求体无效", "Invalid request body", err), err)
		}
		role := normalizeRole(body.Role)
		user, err := createUser(app, body.Name, body.Email, body.Password, role)
		if err != nil {
			return e.BadRequestError(tr(locale, "用户创建失败", "Failed to create user"), err)
		}
		return e.JSON(http.StatusCreated, adminUserResponse{User: toUserDTO(user)})
	})
	admin.PATCH("/users/{id}", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		id := e.Request.PathValue("id")
		user, err := app.FindRecordById("users", id)
		if err != nil {
			return e.NotFoundError(tr(locale, "用户不存在", "User not found"), err)
		}
		body, err := decodeStrictJSON[adminPatchUserRequest](e.Request, locale)
		if err != nil {
			return e.BadRequestError(validationErrorMessage(locale, "请求参数无效", "Invalid request parameters", err), err)
		}
		if body.Role != nil {
			user.Set("role", normalizeRole(*body.Role))
		}
		if body.Banned != nil {
			user.Set("banned", *body.Banned)
			if *body.Banned {
				user.Set("banReason", localizedDisabledBanReason(locale))
			} else {
				user.Set("banReason", "")
			}
		}
		if body.NewPassword != nil {
			user.SetPassword(*body.NewPassword)
		}
		// 防自锁保护放在 Save 前，避免当前管理员把自己降级/禁用后无法恢复系统。
		if err := preventLastAdminMutation(app, e.Auth, user); err != nil {
			return e.BadRequestError(localizeAdminMutationError(locale, err), nil)
		}
		if err := app.Save(user); err != nil {
			return e.BadRequestError(tr(locale, "用户更新失败", "Failed to update user"), err)
		}
		return e.JSON(http.StatusOK, newOKResponse())
	})
	admin.DELETE("/users/{id}", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		id := e.Request.PathValue("id")
		user, err := app.FindRecordById("users", id)
		if err != nil {
			return e.NotFoundError(tr(locale, "用户不存在", "User not found"), err)
		}
		if err := preventUserDelete(app, e.Auth, user); err != nil {
			return e.BadRequestError(localizeAdminMutationError(locale, err), nil)
		}
		if err := app.Delete(user); err != nil {
			return e.BadRequestError(tr(locale, "用户删除失败", "Failed to delete user"), err)
		}
		return e.JSON(http.StatusOK, newOKResponse())
	})

	auth := router.Group("/api/app").Bind(apis.RequireAuth("users"))
	auth.PUT("/account/password", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		body, err := decodeStrictJSON[accountPasswordRequest](e.Request, locale)
		if err != nil {
			return e.BadRequestError(validationErrorMessage(locale, "请求体无效", "Invalid request body", err), err)
		}
		if !e.Auth.ValidatePassword(body.CurrentPassword) {
			return e.BadRequestError(tr(locale, "当前密码不正确", "Current password is incorrect"), nil)
		}
		e.Auth.SetPassword(body.NewPassword)
		if err := app.Save(e.Auth); err != nil {
			return e.BadRequestError(tr(locale, "密码更新失败", "Failed to update password"), err)
		}
		return e.JSON(http.StatusOK, newOKResponse())
	})
	auth.POST("/notifications/test", func(e *core.RequestEvent) error { return handleNotificationTest(app, e) })
	auth.GET("/notifications/history", func(e *core.RequestEvent) error { return handleNotificationHistory(app, e) })
	auth.POST("/notifications/run", func(e *core.RequestEvent) error { return handleNotificationRun(app, e) })
	auth.GET("/assets/{id}", func(e *core.RequestEvent) error { return handleAssetRead(app, e) })
	auth.GET("/favicon-search", faviconSearch)

	router.GET("/api/app/account/password-reset/status", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, passwordResetStatusResponse{Enabled: app.Settings().SMTP.Enabled})
	})
	router.GET("/api/app/thesvg-icons", theSvgSearch)
}
