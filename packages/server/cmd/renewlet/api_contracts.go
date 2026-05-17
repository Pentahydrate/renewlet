package main

// api_contracts.go 定义自定义 HTTP API 的请求/响应边界。
//
// 架构位置：
//   - main.go 的 route handler 只处理鉴权、业务编排和 PocketBase 调用。
//   - 本文件集中放置 DTO、严格 JSON decoder、Validate(locale) 约定和通用错误响应。
//   - 前端 Zod schema 与这里的 struct 字段需要保持一一对应。
//
// 请求解码流转：
//   request.Body -> 限制 1MiB -> DisallowUnknownFields -> 拒绝多余 JSON token
//     -> 若实现 localizedValidator 则调用 Validate(locale)
//
// 注意： 不要把 decoder 放宽成 map 或忽略未知字段；未知字段通常代表前后端契约漂移，应在边界失败。
import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/tools/types"
)

const maxJSONBodyBytes = 1 << 20

var errEmptyJSONBody = errors.New("empty JSON body")

// localizedValidator 是请求体的本地化校验约定。
// Validate 在 JSON 结构通过后执行，用于枚举、邮箱、密码长度等产品语义校验。
type localizedValidator interface {
	Validate(appLocale) error
}

// okResponse 是“无额外数据”的成功响应。
// 注意： 需要携带业务字段时应新增专用 response struct，不要扩宽这个公共契约。
type okResponse struct {
	OK bool `json:"ok"`
}

// cronErrorResponse 是外部调度入口的配置/鉴权错误响应。
type cronErrorResponse struct {
	OK      bool   `json:"ok"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// emptyJSONPayload 表示数据库 JSON 字段的空对象。
// 它用于避免 nil/null 在前端 schema 中被误解成“字段缺失”。
type emptyJSONPayload struct{}

// healthResponse 是 healthcheck 的稳定响应结构。
type healthResponse struct {
	OK   bool   `json:"ok"`
	Time string `json:"time"`
}

// setupStatusResponse 描述初始化入口是否可用。
// 前端会据此展示 setup 流程，因此字段缺失必须被 schema 拒绝。
type setupStatusResponse struct {
	SetupRequired bool `json:"setupRequired"`
	SetupEnabled  bool `json:"setupEnabled"`
}

// setupCreateRequest 是首次初始化管理员的请求体。
type setupCreateRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Validate 校验首次管理员信息，并在边界处完成 trim。
func (r *setupCreateRequest) Validate(locale appLocale) error {
	r.Name = strings.TrimSpace(r.Name)
	r.Email = strings.TrimSpace(r.Email)
	if r.Name == "" || !isValidEmailAddress(r.Email) || len(r.Password) < 8 {
		return errors.New(tr(locale, "管理员信息无效", "Invalid admin information"))
	}
	return nil
}

// adminUsersResponse 是管理员用户列表响应。
type adminUsersResponse struct {
	Users []userDTO `json:"users"`
}

// adminCreateUserRequest 是管理员创建用户的请求体。
type adminCreateUserRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

// Validate 校验管理员创建用户的请求体。
// 注意： role 是权限边界，新增角色时必须同步前端 schema 和所有防自锁逻辑。
func (r *adminCreateUserRequest) Validate(locale appLocale) error {
	r.Name = strings.TrimSpace(r.Name)
	r.Email = strings.TrimSpace(r.Email)
	if r.Name == "" || !isValidEmailAddress(r.Email) || len(r.Password) < 8 {
		return errors.New(tr(locale, "用户信息无效", "Invalid user information"))
	}
	if r.Role != "admin" && r.Role != "user" {
		return errors.New(tr(locale, "角色无效", "Invalid role"))
	}
	return nil
}

// adminUserResponse 是单用户写入后的响应结构。
type adminUserResponse struct {
	User userDTO `json:"user"`
}

// adminPatchUserRequest 是管理员局部更新用户的请求体。
// 指针字段用于区分“未传字段”和“显式传 false/空字符串”。
type adminPatchUserRequest struct {
	Role        *string `json:"role,omitempty"`
	Banned      *bool   `json:"banned,omitempty"`
	NewPassword *string `json:"newPassword,omitempty"`
}

// Validate 校验管理员用户 patch 请求。
// 为什么要求至少一个字段：空 patch 通常意味着前端状态机误触发，应该显式失败。
func (r *adminPatchUserRequest) Validate(locale appLocale) error {
	if r.Role == nil && r.Banned == nil && r.NewPassword == nil {
		return errors.New(tr(locale, "请求参数无效", "Invalid request parameters"))
	}
	if r.Role != nil {
		role := strings.TrimSpace(*r.Role)
		if role != "admin" && role != "user" {
			return errors.New(tr(locale, "角色无效", "Invalid role"))
		}
		*r.Role = role
	}
	if r.NewPassword != nil {
		if len(*r.NewPassword) < 8 {
			return errors.New(tr(locale, "密码至少需要 8 位", "Password must be at least 8 characters"))
		}
	}
	return nil
}

// accountPasswordRequest 是当前用户修改密码的请求体。
type accountPasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

// Validate 校验账号密码修改请求。
func (r *accountPasswordRequest) Validate(locale appLocale) error {
	if r.CurrentPassword == "" || len(r.NewPassword) < 8 {
		return errors.New(tr(locale, "密码至少需要 8 位", "Password must be at least 8 characters"))
	}
	return nil
}

// passwordResetStatusResponse 暴露“邮件找回密码是否启用”的布尔状态。
type passwordResetStatusResponse struct {
	Enabled bool `json:"enabled"`
}

// rateLimitedResponse 是简单限流响应。
type rateLimitedResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// faviconSearchResponse 是 favicon/logo 远端增强搜索响应。
type faviconSearchResponse struct {
	ImageURLs []string `json:"imageUrls"`
	Kind      string   `json:"kind"`
}

// theSvgIconsResponse 是 The SVG 索引搜索响应。
type theSvgIconsResponse struct {
	Icons []apiTheSvgIcon `json:"icons"`
}

// decodeStrictJSON 从 HTTP 请求体解码严格 JSON。
func decodeStrictJSON[T interface{}](request *http.Request, locale appLocale) (T, error) {
	return decodeStrictJSONFromReader[T](request.Body, locale, false)
}

// decodeOptionalStrictJSON 解码可为空的严格 JSON。
// 手动通知运行允许空 body，因此这里把“空 body”与“非法 JSON”区分开。
func decodeOptionalStrictJSON[T interface{}](request *http.Request, locale appLocale) (T, error) {
	return decodeStrictJSONFromReader[T](request.Body, locale, true)
}

// decodeStrictJSONFromReader 限制请求体大小后再进入 JSON decoder。
// 这样能在 DisallowUnknownFields 前先阻断异常大 body，避免内存被恶意请求放大。
func decodeStrictJSONFromReader[T interface{}](reader io.Reader, locale appLocale, allowEmpty bool) (T, error) {
	var zero T
	if reader == nil {
		if allowEmpty {
			return zero, nil
		}
		return zero, errEmptyJSONBody
	}
	data, err := io.ReadAll(io.LimitReader(reader, maxJSONBodyBytes+1))
	if err != nil {
		return zero, err
	}
	if len(data) > maxJSONBodyBytes {
		return zero, errors.New("JSON body too large")
	}
	return decodeStrictJSONFromBytes[T](data, locale, allowEmpty)
}

// decodeStrictJSONFromBytes 将字节流解码为强类型请求体。
func decodeStrictJSONFromBytes[T interface{}](data []byte, locale appLocale, allowEmpty bool) (T, error) {
	var body T
	err := decodeStrictJSONBytesInto(data, &body, locale, allowEmpty)
	return body, err
}

// decodeStrictJSONBytesInto 是严格 JSON 解码的核心实现。
// 注意： `decoder.Decode(&extra)` 用于拒绝第二个 JSON token，防止 `{} {}` 这类拼接 body 被部分接受。
func decodeStrictJSONBytesInto(data []byte, target interface{}, locale appLocale, allowEmpty bool) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		if allowEmpty {
			return nil
		}
		return errEmptyJSONBody
	}

	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra struct{}
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("JSON body must contain a single value")
		}
		return err
	}
	if validator, ok := target.(localizedValidator); ok {
		if err := validator.Validate(locale); err != nil {
			return err
		}
	}
	return nil
}

// isValidEmailAddress 用 net/mail 做基础邮箱语义校验。
func isValidEmailAddress(value string) bool {
	if value == "" || strings.ContainsAny(value, " \t\r\n") {
		return false
	}
	address, err := mail.ParseAddress(value)
	return err == nil && address.Address == value
}

// newOKResponse 返回通用成功响应。
func newOKResponse() okResponse {
	return okResponse{OK: true}
}

// newHealthResponse 返回带 UTC 时间戳的 healthcheck 响应。
func newHealthResponse() healthResponse {
	return healthResponse{
		OK:   true,
		Time: time.Now().UTC().Format(time.RFC3339Nano),
	}
}

// invalidRequestBodyMessage 返回本地化请求体错误文案。
func invalidRequestBodyMessage(locale appLocale) string {
	return tr(locale, "请求体无效", "Invalid request body")
}

// validationErrorMessage 优先透出 Validate 返回的具体错误。
func validationErrorMessage(locale appLocale, fallbackZh string, fallbackEn string, err error) string {
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		return err.Error()
	}
	return tr(locale, fallbackZh, fallbackEn)
}

// rawJSONIsNull 判断可选 RawMessage 是否显式传入 null。
// 显式 null 与省略字段语义不同：通知临时 settings 传 null 应被视作非法输入。
func rawJSONIsNull(value json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(value), []byte("null"))
}

// jsonBytesFromValue 将 PocketBase JSON 字段的多种运行时形态统一成 bytes。
// 注意： 这里只做格式桥接，真正的 schema 校验必须在调用方继续完成。
func jsonBytesFromValue(value interface{}) ([]byte, error) {
	if value == nil {
		return nil, nil
	}
	switch v := value.(type) {
	case json.RawMessage:
		return []byte(v), nil
	case types.JSONRaw:
		return []byte(v), nil
	case []byte:
		return v, nil
	case string:
		return []byte(v), nil
	default:
		return json.Marshal(v)
	}
}
