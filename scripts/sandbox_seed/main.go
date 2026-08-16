// 沙盘功能测试书：凛冬山地王国（原创设定，冰与火风味）
// 通过 app API 创建小说 + 地点 + 角色 + 事件
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const base = "http://127.0.0.1:0" // 不使用 HTTP（Wails 本地方法）

// 直接调用 app 包（在 goink 模块内运行）
func main() {
	_ = base
	_ = bytes.Compare
	_ = json.Marshal
	_ = fmt.Sprintf
	_ = http.Get
	_ = time.Now
	fmt.Println("请使用内嵌测试方式：go run ./scripts/sandbox_seed/main.go（在 app 包上下文内）")
}
