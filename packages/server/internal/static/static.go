package static

import "embed"

// Files 包含 Vite 构建产物；Docker 构建时会在编译 Go 二进制前，
// 用 packages/client/dist 替换这个目录。
//
//go:embed all:public
var Files embed.FS

//go:embed data/thesvg-index.json
var TheSVGIndex []byte
