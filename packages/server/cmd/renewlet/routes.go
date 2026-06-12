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
	router.GET("/api/app/ready", func(e *core.RequestEvent) error {
		ready, err := newReadyResponse(app)
		if err != nil {
			return e.InternalServerError(serverText(requestLocale(e.Request), "common.internalError"), err)
		}
		return e.JSON(http.StatusOK, ready)
	})

	router.GET("/api/app/status", func(e *core.RequestEvent) error {
		// app status 是认证前 capability 源；前端置灰和 setup 可见性都只读这一处，不再从页面里猜部署模式。
		return e.JSON(http.StatusOK, appStatusResponse{
			SetupRequired: !hasEnabledAdmin(app),
			SetupEnabled:  demoModePolicy.SetupEnabled(),
			DemoMode:      demoModePolicy.Enabled(),
		})
	})
	router.GET("/api/app/setup", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, setupStatusResponse{
			SetupRequired: !hasEnabledAdmin(app),
			SetupEnabled:  demoModePolicy.SetupEnabled(),
		})
	})
	router.GET("/api/public/status/{token}", func(e *core.RequestEvent) error { return handlePublicStatusRead(app, e) })
	router.GET("/api/public/status/{token}/assets/{assetId}", func(e *core.RequestEvent) error { return handlePublicStatusAssetRead(app, e) })
	router.GET("/calendar/renewals.ics", func(e *core.RequestEvent) error { return handleCalendarFeedICS(app, e) })
	router.GET("/api/cron/notifications", func(e *core.RequestEvent) error { return handleNotificationCron(app, e) })
	router.POST("/api/app/setup", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		if !demoModePolicy.SetupEnabled() {
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
		if err := demoModePolicy.RejectTargetUserMutation(e, user); err != nil {
			return err
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
			if e.Auth != nil && e.Auth.Id == user.Id {
				// 自己改密码必须走 /account/password 校验当前密码，不能让管理员 patch 成为弱认证入口。
				return e.BadRequestError(serverText(locale, "auth.selfPasswordResetForbidden"), nil)
			}
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
		if err := demoModePolicy.RejectTargetUserMutation(e, user); err != nil {
			return err
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
				if details := systemUpstreamErrorDetails(err); details != nil {
					return e.JSON(http.StatusInternalServerError, map[string]interface{}{
						"message": serverText(locale, "system.updateFailed"),
						"code":    "SYSTEM_UPDATE_FAILED",
						"details": details,
					})
				}
				return e.InternalServerError(serverText(locale, "system.updateFailed"), err)
			}
		}
		if err := e.JSON(http.StatusOK, result); err != nil {
			return err
		}
		return nil
	})
	admin.POST("/system/restart", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		if _, err := decodeStrictJSON[systemRestartRequest](e.Request, locale); err != nil {
			return e.BadRequestError(validationErrorMessage(locale, "common.invalidRequestBody", err), err)
		}
		if err := defaultSystemUpdateService.ConfirmRestart(locale); err != nil {
			return e.BadRequestError(err.Error(), nil)
		}
		if err := e.JSON(http.StatusOK, newOKResponse()); err != nil {
			return err
		}
		// 只在管理员显式确认后退出，确保前端能先展示“更新完成”并开始等待健康检查恢复。
		defaultSystemUpdateService.ScheduleRestart()
		return nil
	})
	admin.GET("/media/icon-index", func(e *core.RequestEvent) error {
		return handleBuiltInIconIndexStatus(app, e)
	})
	admin.POST("/media/icon-index/providers/{provider}/check", func(e *core.RequestEvent) error {
		return handleBuiltInIconIndexProviderCheck(app, e)
	})
	admin.POST("/media/icon-index/providers/{provider}/refresh", func(e *core.RequestEvent) error {
		return handleBuiltInIconIndexProviderRefresh(app, e)
	})

	auth := router.Group("/api/app").Bind(apis.RequireAuth("users"))
	auth.PUT("/account/password", func(e *core.RequestEvent) error {
		locale := requestLocale(e.Request)
		if err := demoModePolicy.RejectAccountMutation(e); err != nil {
			return err
		}
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
	auth.POST("/notifications/test", demoModeExternalSideEffectGuard(func(e *core.RequestEvent) error { return handleNotificationTest(app, e) }))
	auth.GET("/notifications/history", func(e *core.RequestEvent) error { return handleNotificationHistory(app, e) })
	auth.POST("/notifications/run", demoModeExternalSideEffectGuard(func(e *core.RequestEvent) error { return handleNotificationRun(app, e) }))
	// 导入预览和应用都要求登录态；冲突判断只在当前用户数据内完成，避免备份里的来源 ID 探测他人订阅。
	auth.POST("/import/preview", func(e *core.RequestEvent) error { return handleImportPreview(app, e) })
	auth.POST("/import/apply", func(e *core.RequestEvent) error { return handleImportApply(app, e) })
	// 云同步与备份只生成可恢复快照；恢复下载后仍必须进入前端 import preview/apply，不直接覆盖数据库。
	auth.GET("/cloud-backup/config", func(e *core.RequestEvent) error { return handleCloudBackupConfigRead(app, e) })
	auth.PUT("/cloud-backup/config", demoModeExternalSideEffectGuard(func(e *core.RequestEvent) error { return handleCloudBackupConfigUpdate(app, e) }))
	auth.POST("/cloud-backup/test", demoModeExternalSideEffectGuard(func(e *core.RequestEvent) error { return handleCloudBackupTest(app, e) }))
	auth.GET("/cloud-backups", demoModeExternalSideEffectGuard(func(e *core.RequestEvent) error { return handleCloudBackupsList(app, e) }))
	auth.POST("/cloud-backups", demoModeExternalSideEffectGuard(func(e *core.RequestEvent) error { return handleCloudBackupsCreate(app, e) }))
	auth.GET("/cloud-backups/{id}/download", demoModeExternalSideEffectGuard(func(e *core.RequestEvent) error { return handleCloudBackupsDownload(app, e) }))
	auth.DELETE("/cloud-backups/{id}", demoModeExternalSideEffectGuard(func(e *core.RequestEvent) error { return handleCloudBackupsDelete(app, e) }))
	// AI 识别只生成导入草稿，不直接写 subscriptions；最终仍必须走 import preview/apply 的用户确认链路。
	auth.POST("/ai/subscriptions/recognize/stream", func(e *core.RequestEvent) error { return handleAIRecognizeSubscriptionsStream(app, e) })
	auth.POST("/ai/subscriptions/recognize", func(e *core.RequestEvent) error { return handleAIRecognizeSubscriptions(app, e) })
	auth.POST("/ai/subscriptions/test", func(e *core.RequestEvent) error { return handleAIRecognitionTestConnection(app, e) })
	auth.POST("/ai/models/list", func(e *core.RequestEvent) error { return handleAIModelsList(app, e) })
	// 业务数据统一经 Renewlet 产品 API；前端不得再直连 PocketBase collection REST，以免 Docker/Cloudflare 运行面漂移。
	auth.GET("/settings", func(e *core.RequestEvent) error { return handleSettingsRead(app, e) })
	auth.PUT("/settings", func(e *core.RequestEvent) error { return handleSettingsUpdate(app, e) })
	auth.GET("/custom-config", func(e *core.RequestEvent) error { return handleCustomConfigRead(app, e) })
	auth.PUT("/custom-config", func(e *core.RequestEvent) error { return handleCustomConfigUpdate(app, e) })
	auth.GET("/subscriptions", func(e *core.RequestEvent) error { return handleSubscriptionsList(app, e) })
	auth.POST("/subscriptions", func(e *core.RequestEvent) error { return handleSubscriptionCreate(app, e) })
	auth.PATCH("/subscriptions/{id}", func(e *core.RequestEvent) error { return handleSubscriptionUpdate(app, e) })
	auth.DELETE("/subscriptions/{id}", func(e *core.RequestEvent) error { return handleSubscriptionDelete(app, e) })
	auth.GET("/assets", func(e *core.RequestEvent) error { return handleAssetsList(app, e) })
	auth.POST("/assets", func(e *core.RequestEvent) error { return handleAssetUpload(app, e) })
	// 私有资产读取必须经过 handler 的 record.user 校验，不能直接暴露 PocketBase protected file URL。
	auth.GET("/assets/{id}", func(e *core.RequestEvent) error { return handleAssetRead(app, e) })
	// Feed 管理 API 只服务登录用户；公开 ICS route 另走 token bearer secret，不复用 session。
	auth.GET("/calendar-feed", func(e *core.RequestEvent) error { return handleCalendarFeedStatus(app, e) })
	auth.POST("/calendar-feed", func(e *core.RequestEvent) error { return handleCalendarFeedCreate(app, e) })
	auth.DELETE("/calendar-feed", func(e *core.RequestEvent) error { return handleCalendarFeedDelete(app, e) })
	auth.GET("/public-status-page", func(e *core.RequestEvent) error { return handlePublicStatusPageStatus(app, e) })
	auth.POST("/public-status-page", func(e *core.RequestEvent) error { return handlePublicStatusPageCreate(app, e) })
	auth.PATCH("/public-status-page", func(e *core.RequestEvent) error { return handlePublicStatusPageUpdate(app, e) })
	auth.DELETE("/public-status-page", func(e *core.RequestEvent) error { return handlePublicStatusPageDelete(app, e) })
	auth.POST("/subscriptions/{id}/renew", func(e *core.RequestEvent) error { return handleSubscriptionRenew(app, e) })
	auth.GET("/subscriptions/{id}/calendar-feed", func(e *core.RequestEvent) error { return handleSubscriptionCalendarFeedStatus(app, e) })
	auth.POST("/subscriptions/{id}/calendar-feed", func(e *core.RequestEvent) error { return handleSubscriptionCalendarFeedCreate(app, e) })
	auth.DELETE("/subscriptions/{id}/calendar-feed", func(e *core.RequestEvent) error { return handleSubscriptionCalendarFeedDelete(app, e) })
	// 媒体候选统一入口承接 favicon 与内置 provider，前端不再拼旧 favicon-search/图标 provider 路径。
	auth.POST("/media/candidates", mediaCandidates)

	router.GET("/api/app/account/password-reset/status", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, passwordResetStatusResponse{Enabled: app.Settings().SMTP.Enabled})
	})
}
