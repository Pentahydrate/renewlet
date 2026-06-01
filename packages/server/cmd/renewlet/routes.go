package main

// routes.go 集中注册 Renewlet 自定义 HTTP API。
//
// 架构位置：
//   - 公共 route 暴露 health/setup/password-reset 状态。
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
	router.GET("/calendar/renewals.ics", func(e *core.RequestEvent) error { return handleCalendarFeedICS(app, e) })
	router.GET("/api/cron/notifications", func(e *core.RequestEvent) error { return handleNotificationCron(app, e) })
	router.POST("/api/app/setup", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		if !envBool("SETUP_ENABLED", true) {
			return e.ForbiddenError(serverText(locale, "auth.setupDisabled"), nil)
		}
		if hasEnabledAdmin(app) {
			return e.ForbiddenError(serverText(locale, "auth.setupAlreadyInitialized"), nil)
		}
		// setup 是认证前入口，必须用严格 decoder 拒绝未知字段和多余 token。
		body, err := decodeStrictJSON[setupCreateRequest](e.Request, locale)
		if err != nil {
			return e.BadRequestError(validationErrorMessage(locale, "common.invalidRequestBody", err), err)
		}
		if err := createInitialAdmin(app, body.Name, body.Email, body.Password); err != nil {
			if errors.Is(err, errSetupAlreadyInitialized) {
				return e.ForbiddenError(serverText(locale, "auth.setupAlreadyInitialized"), nil)
			}
			return e.BadRequestError(serverText(locale, "admin.createFailed"), err)
		}
		return e.JSON(http.StatusCreated, newOKResponse())
	})

	admin := router.Group("/api/app/admin").Bind(apis.RequireAuth("users")).BindFunc(requireAdmin)
	admin.GET("/users", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		users, err := app.FindAllRecords("users")
		if err != nil {
			return e.InternalServerError(serverText(locale, "admin.loadUsersFailed"), err)
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
			return e.BadRequestError(validationErrorMessage(locale, "common.invalidRequestBody", err), err)
		}
		role := normalizeRole(body.Role)
		user, err := createUser(app, body.Name, body.Email, body.Password, role)
		if err != nil {
			return e.BadRequestError(serverText(locale, "admin.createUserFailed"), err)
		}
		return e.JSON(http.StatusCreated, adminUserResponse{User: toUserDTO(user)})
	})
	admin.PATCH("/users/{id}", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		id := e.Request.PathValue("id")
		user, err := app.FindRecordById("users", id)
		if err != nil {
			return e.NotFoundError(serverText(locale, "auth.userNotFound"), err)
		}
		body, err := decodeStrictJSON[adminPatchUserRequest](e.Request, locale)
		if err != nil {
			return e.BadRequestError(validationErrorMessage(locale, "common.invalidRequestParameters", err), err)
		}
		if body.Role != nil {
			user.Set("role", normalizeRole(*body.Role))
		}
		if body.Banned != nil {
			user.Set("banned", *body.Banned)
			if *body.Banned {
				user.Set("banReason", serverText(locale, "auth.accountDisabledByAdmin"))
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
			return e.BadRequestError(serverText(locale, "admin.updateUserFailed"), err)
		}
		return e.JSON(http.StatusOK, newOKResponse())
	})
	admin.DELETE("/users/{id}", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		id := e.Request.PathValue("id")
		user, err := app.FindRecordById("users", id)
		if err != nil {
			return e.NotFoundError(serverText(locale, "auth.userNotFound"), err)
		}
		if err := preventUserDelete(app, e.Auth, user); err != nil {
			return e.BadRequestError(localizeAdminMutationError(locale, err), nil)
		}
		if err := app.Delete(user); err != nil {
			return e.BadRequestError(serverText(locale, "admin.deleteUserFailed"), err)
		}
		return e.JSON(http.StatusOK, newOKResponse())
	})
	admin.GET("/system/version", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		force := e.Request.URL.Query().Get("force") == "true"
		info, err := defaultSystemUpdateService.CheckVersion(e.Request.Context(), locale, force)
		if err != nil {
			return e.InternalServerError(serverText(locale, "system.checkVersionFailed"), err)
		}
		return e.JSON(http.StatusOK, info)
	})
	admin.POST("/system/update", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		if _, err := decodeStrictJSON[systemUpdateRequest](e.Request, locale); err != nil {
			return e.BadRequestError(validationErrorMessage(locale, "common.invalidRequestBody", err), err)
		}
		result, err := defaultSystemUpdateService.PerformUpdate(e.Request.Context(), locale)
		if err != nil {
			switch {
			case errors.Is(err, errSystemUpdateInProgress):
				return e.TooManyRequestsError(err.Error(), nil)
			case errors.Is(err, errSystemUpdateUnsupported), errors.Is(err, errSystemUpdateNoUpdate):
				return e.BadRequestError(err.Error(), nil)
			default:
				return e.InternalServerError(serverText(locale, "system.updateFailed"), err)
			}
		}
		if err := e.JSON(http.StatusOK, result); err != nil {
			return err
		}
		defaultSystemUpdateService.ScheduleRestart()
		return nil
	})

	auth := router.Group("/api/app").Bind(apis.RequireAuth("users"))
	auth.PUT("/account/password", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		body, err := decodeStrictJSON[accountPasswordRequest](e.Request, locale)
		if err != nil {
			return e.BadRequestError(validationErrorMessage(locale, "common.invalidRequestBody", err), err)
		}
		if !e.Auth.ValidatePassword(body.CurrentPassword) {
			return e.BadRequestError(serverText(locale, "auth.currentPasswordIncorrect"), nil)
		}
		e.Auth.SetPassword(body.NewPassword)
		if err := app.Save(e.Auth); err != nil {
			return e.BadRequestError(serverText(locale, "auth.passwordUpdateFailed"), err)
		}
		return e.JSON(http.StatusOK, newOKResponse())
	})
	auth.POST("/notifications/test", func(e *core.RequestEvent) error { return handleNotificationTest(app, e) })
	auth.GET("/notifications/history", func(e *core.RequestEvent) error { return handleNotificationHistory(app, e) })
	auth.POST("/notifications/run", func(e *core.RequestEvent) error { return handleNotificationRun(app, e) })
	auth.POST("/import/preview", func(e *core.RequestEvent) error { return handleImportPreview(app, e) })
	auth.POST("/import/apply", func(e *core.RequestEvent) error { return handleImportApply(app, e) })
	auth.GET("/assets/{id}", func(e *core.RequestEvent) error { return handleAssetRead(app, e) })
	auth.GET("/calendar-feed", func(e *core.RequestEvent) error { return handleCalendarFeedStatus(app, e) })
	auth.POST("/calendar-feed", func(e *core.RequestEvent) error { return handleCalendarFeedCreate(app, e) })
	auth.DELETE("/calendar-feed", func(e *core.RequestEvent) error { return handleCalendarFeedDelete(app, e) })
	auth.GET("/subscriptions/{id}/calendar-feed", func(e *core.RequestEvent) error { return handleSubscriptionCalendarFeedStatus(app, e) })
	auth.POST("/subscriptions/{id}/calendar-feed", func(e *core.RequestEvent) error { return handleSubscriptionCalendarFeedCreate(app, e) })
	auth.DELETE("/subscriptions/{id}/calendar-feed", func(e *core.RequestEvent) error { return handleSubscriptionCalendarFeedDelete(app, e) })
	auth.POST("/media/candidates", mediaCandidates)

	router.GET("/api/app/account/password-reset/status", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, passwordResetStatusResponse{Enabled: app.Settings().SMTP.Enabled})
	})
}
