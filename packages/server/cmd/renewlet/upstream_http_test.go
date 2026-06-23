package main

import (
	"crypto/tls"
	"errors"
	"net/http"
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
