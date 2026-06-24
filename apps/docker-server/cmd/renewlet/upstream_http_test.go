package main

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDefaultUpstreamHTTPClientKeepsProxyAndTLSPolicy(t *testing.T) {
	client := defaultUpstreamHTTPClient(15 * time.Second)
	if client.Timeout != 15*time.Second {
		t.Fatalf("unexpected timeout %s", client.Timeout)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("expected *http.Transport, got %T", client.Transport)
	}
	if transport.Proxy == nil {
		t.Fatal("expected environment proxy function")
	}
	if reflect.ValueOf(transport.Proxy).Pointer() != reflect.ValueOf(http.ProxyFromEnvironment).Pointer() {
		t.Fatal("expected upstream HTTP client to preserve http.ProxyFromEnvironment")
	}
	if transport.TLSClientConfig == nil || transport.TLSClientConfig.MinVersion != tls.VersionTLS12 {
		t.Fatalf("expected TLS 1.2 minimum, got %#v", transport.TLSClientConfig)
	}
}

func TestDefaultUpstreamHTTPClientRoutesHTTPSThroughEnvironmentProxy(t *testing.T) {
	proxyURL, requests := startHTTPProxyRecorder(t)
	// 子进程隔离宿主机代理环境，避免开发机已有 HTTP(S)_PROXY 污染 CONNECT 断言。
	cmd := exec.Command(os.Args[0], "-test.run=^TestUpstreamHTTPProxyChild$", "-test.count=1")
	cmd.Env = upstreamHTTPProxyChildEnv(map[string]string{
		"RENEWLET_TEST_UPSTREAM_PROXY_CHILD": "connect",
		"HTTPS_PROXY":                        proxyURL,
	})
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("proxy child failed: %v\n%s", err, output)
	}
	select {
	case got := <-requests:
		if got != "CONNECT api.telegram.org:443 HTTP/1.1" {
			t.Fatalf("unexpected proxy request line %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected HTTPS request to reach proxy")
	}
}

func TestDefaultUpstreamHTTPClientHonorsNoProxyForTelegram(t *testing.T) {
	// NO_PROXY 属于 Go 标准代理决策；这里用子进程锁住“配置了代理也可被排除”的行为。
	cmd := exec.Command(os.Args[0], "-test.run=^TestUpstreamHTTPProxyChild$", "-test.count=1")
	cmd.Env = upstreamHTTPProxyChildEnv(map[string]string{
		"RENEWLET_TEST_UPSTREAM_PROXY_CHILD": "noproxy",
		"HTTPS_PROXY":                        "http://127.0.0.1:9",
		"NO_PROXY":                           "api.telegram.org",
	})
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("NO_PROXY child failed: %v\n%s", err, output)
	}
}

func TestUpstreamHTTPProxyChild(t *testing.T) {
	switch os.Getenv("RENEWLET_TEST_UPSTREAM_PROXY_CHILD") {
	case "":
		t.Skip("helper process only")
	case "connect":
		client := defaultUpstreamHTTPClient(2 * time.Second)
		resp, err := client.Get("https://api.telegram.org/botredacted/sendMessage")
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		if err == nil {
			t.Fatal("expected fake proxy to abort the CONNECT request")
		}
	case "noproxy":
		request, err := http.NewRequest(http.MethodGet, "https://api.telegram.org/botredacted/sendMessage", nil)
		if err != nil {
			t.Fatal(err)
		}
		proxy, err := defaultUpstreamHTTPTransport().Proxy(request)
		if err != nil {
			t.Fatal(err)
		}
		if proxy != nil {
			t.Fatalf("expected NO_PROXY to suppress proxy, got %s", proxy.Redacted())
		}
	default:
		t.Fatalf("unknown child mode %q", os.Getenv("RENEWLET_TEST_UPSTREAM_PROXY_CHILD"))
	}
}

func TestLogUpstreamHTTPProxyEnvironmentRedactsCredentialsAndDetectsLoopback(t *testing.T) {
	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"} {
		t.Setenv(key, "")
	}
	t.Setenv("HTTPS_PROXY", "http://user:secret@127.0.0.1:7890")
	t.Setenv("NO_PROXY", "localhost,.internal")

	summary := upstreamHTTPProxyEnvironmentSummaryFromEnv()
	if strings.Join(summary.Variables, ",") != "HTTPS_PROXY,NO_PROXY" {
		t.Fatalf("unexpected proxy variables: %#v", summary.Variables)
	}
	if summary.credentialsStatus() != "present" || strings.Join(summary.CredentialVariables, ",") != "HTTPS_PROXY" {
		t.Fatalf("expected credential presence without values, got %#v", summary)
	}
	if strings.Join(summary.LoopbackVariables, ",") != "HTTPS_PROXY" {
		t.Fatalf("expected loopback proxy warning variable, got %#v", summary.LoopbackVariables)
	}

	var buffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buffer, nil))
	logUpstreamHTTPProxyEnvironment(logger)
	logs := buffer.String()
	for _, forbidden := range []string{"user", "secret", "127.0.0.1:7890"} {
		if strings.Contains(logs, forbidden) {
			t.Fatalf("proxy startup log leaked %q: %s", forbidden, logs)
		}
	}
	for _, want := range []string{"credentials=present", "HTTPS_PROXY", "NO_PROXY", "level=WARN"} {
		if !strings.Contains(logs, want) {
			t.Fatalf("expected proxy startup log to contain %q, got %s", want, logs)
		}
	}
}

func TestUnifiedUpstreamHTTPTransportSharedByAdapters(t *testing.T) {
	// 这组断言防止通知、AI、S3 或 WebDAV adapter 绕开统一 Docker/Go 上游出口。
	notificationTransport, ok := defaultNotificationHTTPClient().Transport.(*http.Transport)
	if !ok {
		t.Fatalf("expected notification transport, got %T", defaultNotificationHTTPClient().Transport)
	}
	assertTransportUsesEnvironmentProxy(t, notificationTransport)

	endpoint := resolveAIProviderEndpoint(aiRecognitionSettings{ProviderType: aiProviderTypeGemini, BaseURL: "https://gateway.example.com/custom/api#"})
	aiTransport, ok := aiProviderRuntimeHTTPClient(endpoint, "v1beta").Transport.(aiProviderRuntimeTransport)
	if !ok {
		t.Fatalf("expected AI runtime transport, got %T", aiProviderRuntimeHTTPClient(endpoint, "v1beta").Transport)
	}
	assertRoundTripperUsesEnvironmentProxy(t, aiTransport.inner)

	s3HTTPClient := &s3CaptureHTTPClient{client: defaultUpstreamHTTPClient(45 * time.Second)}
	assertRoundTripperUsesEnvironmentProxy(t, s3HTTPClient.client.Transport)

	webDAVTransport := &webDAVCaptureTransport{base: defaultUpstreamHTTPTransport()}
	assertRoundTripperUsesEnvironmentProxy(t, webDAVTransport.base)
}

func TestUpstreamTransportDiagnosticUsesFullRedactedRequestContext(t *testing.T) {
	request, err := http.NewRequest(
		http.MethodPost,
		"https://discord.com/api/webhooks/123/discord-secret?wait=true&token=bot-secret",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer bot-secret")
	request.Header.Set("Content-Type", "application/json")
	message := upstreamTransportDiagnosticMessage(request, upstreamHTTPRequestOptions{
		Provider: "Discord",
		Timeout:  10 * time.Second,
		Secrets:  []string{"discord-secret", "bot-secret"},
		Body:     []byte(`{"token":"bot-secret","content":"hello"}`),
	}, errors.New("Network connection lost for https://discord.com/api/webhooks/123/discord-secret?wait=true&token=bot-secret"), 10*time.Second, false)

	for _, want := range []string{
		"Discord POST request to https://discord.com/api/webhooks/123/[redacted]?token=%5Bredacted%5D&wait=true failed before response headers",
		"Network connection lost for https://discord.com/api/webhooks/123/[redacted]?token=[redacted]&wait=true",
		`"authorization":"[redacted]"`,
		`"content-type":"application/json"`,
		`"token":"[redacted]"`,
		`"content":"hello"`,
	} {
		if !strings.Contains(message, want) {
			t.Fatalf("expected diagnostic to contain %q, got %q", want, message)
		}
	}
	for _, forbidden := range []string{"discord-secret", "bot-secret"} {
		if strings.Contains(message, forbidden) {
			t.Fatalf("diagnostic leaked %q: %s", forbidden, message)
		}
	}
}

func startHTTPProxyRecorder(t *testing.T) (string, <-chan string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	requests := make(chan string, 1)
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		// HTTPS 代理在 TLS 前先发 CONNECT；假代理记录首行即可，不需要完成远端握手。
		line, _ := bufio.NewReader(conn).ReadString('\n')
		requests <- strings.TrimSpace(line)
		_, _ = conn.Write([]byte("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n"))
	}()
	return "http://" + listener.Addr().String(), requests
}

func upstreamHTTPProxyChildEnv(overrides map[string]string) []string {
	clean := []string{}
	// 代理测试必须白盒控制 env；继承宿主机代理会让 CI 和本地结果取决于机器配置。
	blocked := map[string]struct{}{
		"HTTP_PROXY":  {},
		"HTTPS_PROXY": {},
		"NO_PROXY":    {},
		"http_proxy":  {},
		"https_proxy": {},
		"no_proxy":    {},
	}
	for _, item := range os.Environ() {
		key, _, _ := strings.Cut(item, "=")
		if _, ok := blocked[key]; ok {
			continue
		}
		clean = append(clean, item)
	}
	for key, value := range overrides {
		clean = append(clean, key+"="+value)
	}
	return clean
}

func assertRoundTripperUsesEnvironmentProxy(t *testing.T, roundTripper http.RoundTripper) {
	t.Helper()
	transport, ok := roundTripper.(*http.Transport)
	if !ok {
		t.Fatalf("expected *http.Transport, got %T", roundTripper)
	}
	assertTransportUsesEnvironmentProxy(t, transport)
}

func assertTransportUsesEnvironmentProxy(t *testing.T, transport *http.Transport) {
	t.Helper()
	if transport == nil || transport.Proxy == nil {
		t.Fatalf("expected transport to preserve environment proxy, got %#v", transport)
	}
	if reflect.ValueOf(transport.Proxy).Pointer() != reflect.ValueOf(http.ProxyFromEnvironment).Pointer() {
		t.Fatal("expected transport proxy to use http.ProxyFromEnvironment")
	}
}
