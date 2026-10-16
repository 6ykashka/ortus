package accesstest

import "testing"

// W1.46 (П-10): на Windows без DOCKER_HOST testcontainers ищет Docker через os.Stat канала docker_engine, а под
// параллельным стартом пакетов Stat получает «All pipe instances are busy» и провайдер падает с «rootless Docker is not
// supported on Windows». Start задаёт DOCKER_HOST сам; заданный пользователем не трогает.
func TestDefaultDockerHost(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name   string
		goos   string
		env    map[string]string
		want   string
		wantOK bool
	}{
		{name: "windows without DOCKER_HOST: the pipe of Docker Desktop", goos: "windows", want: "npipe:////./pipe/docker_engine", wantOK: true},
		{name: "windows with DOCKER_HOST: kept", goos: "windows", env: map[string]string{"DOCKER_HOST": "tcp://127.0.0.1:2375"}},
		{name: "linux: the socket is found without a pipe", goos: "linux"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, ok := defaultDockerHost(tt.goos, func(k string) string { return tt.env[k] })
			if got != tt.want || ok != tt.wantOK {
				t.Errorf("defaultDockerHost(%s) = %q, %v; want %q, %v", tt.goos, got, ok, tt.want, tt.wantOK)
			}
		})
	}
}
