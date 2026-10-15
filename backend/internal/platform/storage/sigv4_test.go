package storage_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// Examples of AWS «Signature Calculations for the Authorization Header» and «Authenticating Requests: Using Query
// Parameters» (Amazon S3 API Reference, Signature Version 4): the same keys, bucket and instant.
var (
	awsSigner = storage.Signer{ //nolint:gosec // G101: the published example keys of the AWS documentation
		AccessKey: "AKIAIOSFODNN7EXAMPLE",
		SecretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		Region:    "us-east-1",
	}
	awsAt = time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC)
)

const awsHost = "https://examplebucket.s3.amazonaws.com"

func TestSignMatchesAWSExamples(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, method, target, payload, signed, want string
		headers                                     map[string]string
	}{
		{
			name: "GET Object", method: http.MethodGet, target: "/test.txt", payload: storage.EmptyPayloadHash,
			headers: map[string]string{"Range": "bytes=0-9"},
			signed:  "host;range;x-amz-content-sha256;x-amz-date",
			want:    "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
		},
		{
			name: "PUT Object", method: http.MethodPut, target: "/test$file.text",
			payload: "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
			headers: map[string]string{"Date": "Fri, 24 May 2013 00:00:00 GMT", "X-Amz-Storage-Class": "REDUCED_REDUNDANCY"},
			signed:  "date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class",
			want:    "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
		},
		{
			name: "GET Bucket Lifecycle", method: http.MethodGet, target: "/?lifecycle", payload: storage.EmptyPayloadHash,
			signed: "host;x-amz-content-sha256;x-amz-date",
			want:   "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543",
		},
		{
			name: "GET Bucket (List Objects)", method: http.MethodGet, target: "/?max-keys=2&prefix=J",
			payload: storage.EmptyPayloadHash,
			signed:  "host;x-amz-content-sha256;x-amz-date",
			want:    "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			r, err := http.NewRequestWithContext(t.Context(), tc.method, awsHost+tc.target, http.NoBody)
			if err != nil {
				t.Fatal(err)
			}
			for k, v := range tc.headers {
				r.Header.Set(k, v)
			}
			awsSigner.Sign(r, tc.payload, awsAt)
			auth := r.Header.Get("Authorization")
			want := "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=" +
				tc.signed + ",Signature=" + tc.want
			if auth != want {
				t.Fatalf("Authorization:\n got %s\nwant %s", auth, want)
			}
			if r.Header.Get("X-Amz-Date") != "20130524T000000Z" || r.Header.Get("X-Amz-Content-Sha256") != tc.payload {
				t.Fatalf("x-amz headers: %v", r.Header)
			}
		})
	}
}

func TestPresignMatchesAWSExample(t *testing.T) {
	t.Parallel()
	u, err := url.Parse(awsHost + "/test.txt")
	if err != nil {
		t.Fatal(err)
	}
	got := awsSigner.Presign(http.MethodGet, u, nil, 24*time.Hour, awsAt)
	q := got.Query()
	want := map[string]string{ //nolint:gosec // G101: the published example of the AWS documentation
		"X-Amz-Algorithm":     "AWS4-HMAC-SHA256",
		"X-Amz-Credential":    "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request",
		"X-Amz-Date":          "20130524T000000Z",
		"X-Amz-Expires":       "86400",
		"X-Amz-SignedHeaders": "host",
		"X-Amz-Signature":     "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
	}
	for k, v := range want {
		if q.Get(k) != v {
			t.Errorf("%s = %q, want %q", k, q.Get(k), v)
		}
	}
	if got.Path != "/test.txt" || got.Host != "examplebucket.s3.amazonaws.com" {
		t.Errorf("presigned URL %s", got)
	}
	if u.RawQuery != "" {
		t.Error("Presign changed its argument")
	}
}

// A signed header (Content-Type of a presigned PUT) is part of the signature: another value is another signature.
func TestPresignSignsExtraHeaders(t *testing.T) {
	t.Parallel()
	u, _ := url.Parse(awsHost + "/quarantine/t/f")
	jpeg := awsSigner.Presign(http.MethodPut, u, http.Header{"Content-Type": {"image/jpeg"}}, 15*time.Minute, awsAt)
	png := awsSigner.Presign(http.MethodPut, u, http.Header{"Content-Type": {"image/png"}}, 15*time.Minute, awsAt)
	if jpeg.Query().Get("X-Amz-SignedHeaders") != "content-type;host" {
		t.Fatalf("signed headers %q", jpeg.Query().Get("X-Amz-SignedHeaders"))
	}
	if jpeg.Query().Get("X-Amz-Signature") == png.Query().Get("X-Amz-Signature") {
		t.Fatal("the content type is not signed")
	}
	if jpeg.Query().Get("X-Amz-Expires") != "900" {
		t.Fatalf("expires %q", jpeg.Query().Get("X-Amz-Expires"))
	}
}

// The size of an upload ticket is a signed header (FILE-02, PLAT-07): Content-Length given to Presign is signed —
// unlike Sign, where the transport owns it — so storage refuses a body of another length.
func TestPresignSignsContentLength(t *testing.T) {
	t.Parallel()
	u, _ := url.Parse(awsHost + "/quarantine/t/f")
	ticket := func(size string) *url.URL {
		h := http.Header{"Content-Type": {"image/jpeg"}, "Content-Length": {size}}
		return awsSigner.Presign(http.MethodPut, u, h, 15*time.Minute, awsAt)
	}
	small, big := ticket("511"), ticket("5368709120")
	if got := small.Query().Get("X-Amz-SignedHeaders"); got != "content-length;content-type;host" {
		t.Fatalf("signed headers %q", got)
	}
	if small.Query().Get("X-Amz-Signature") == big.Query().Get("X-Amz-Signature") {
		t.Fatal("the size is not signed")
	}
}

// Query parameters of the URL (response-content-disposition) are signed and encoded with %20, not «+».
func TestPresignKeepsAndEncodesQuery(t *testing.T) {
	t.Parallel()
	u, _ := url.Parse(awsHost + "/files/t/f")
	q := url.Values{"response-content-disposition": {`attachment; filename="a b.jpg"`}}
	u.RawQuery = q.Encode()
	got := awsSigner.Presign(http.MethodGet, u, nil, time.Minute, awsAt)
	if got.Query().Get("response-content-disposition") != `attachment; filename="a b.jpg"` {
		t.Fatalf("query lost: %s", got.RawQuery)
	}
	if strings.Contains(got.RawQuery, "+") {
		t.Fatalf("query must use %%20, got %s", got.RawQuery)
	}
}

func TestEscapePath(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"/test.txt":              "/test.txt",
		"/test$file.text":        "/test%24file.text",
		"/b/files/Фото 1.jpg":    "/b/files/%D0%A4%D0%BE%D1%82%D0%BE%201.jpg",
		"/b/a~b_c-d.e":           "/b/a~b_c-d.e",
		"/b/q+r=s&t":             "/b/q%2Br%3Ds%26t",
		"":                       "/",
		"/bucket/quarantine/x/y": "/bucket/quarantine/x/y",
	}
	for in, want := range cases {
		if got := storage.EscapePath(in); got != want {
			t.Errorf("EscapePath(%q) = %q, want %q", in, got, want)
		}
	}
}
