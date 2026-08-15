package novel

import (
	"encoding/json"
	"fmt"
)

// Volume 是卷定义（虚拟分组，只影响展示/组织，不改文件路径）。
type Volume struct {
	Name string `json:"name"`
}

// DefaultVolumes 返回默认卷定义（第一卷）。
func DefaultVolumes() []Volume {
	return []Volume{{Name: "第一卷"}}
}

// ParseVolumes 解析卷定义 JSON；空/非法返回默认第一卷。
func ParseVolumes(raw string) []Volume {
	if raw == "" {
		return DefaultVolumes()
	}
	var vols []Volume
	if err := json.Unmarshal([]byte(raw), &vols); err != nil || len(vols) == 0 {
		return DefaultVolumes()
	}
	// 兜底：空名卷补默认名
	for i := range vols {
		if vols[i].Name == "" {
			vols[i].Name = fmt.Sprintf("第%d卷", i+1)
		}
	}
	return vols
}

// VolumesJSON 序列化卷定义。
func VolumesJSON(vols []Volume) string {
	if len(vols) == 0 {
		return ""
	}
	b, _ := json.Marshal(vols)
	return string(b)
}

// AddVolume 追加一个卷（返回新 JSON 与序号）。
func AddVolume(current string, name string) (string, int) {
	vols := ParseVolumes(current)
	vols = append(vols, Volume{Name: name})
	return VolumesJSON(vols), len(vols)
}

// RenameVolume 重命名卷（index 从 1 开始）。
func RenameVolume(current string, index int, name string) string {
	vols := ParseVolumes(current)
	if index < 1 || index > len(vols) {
		return current
	}
	vols[index-1].Name = name
	return VolumesJSON(vols)
}

// DeleteVolume 删除卷（返回新 JSON 与是否成功）。
func DeleteVolume(current string, index int) (string, bool) {
	vols := ParseVolumes(current)
	if index < 1 || index > len(vols) {
		return current, false
	}
	vols = append(vols[:index-1], vols[index:]...)
	if len(vols) == 0 {
		vols = DefaultVolumes()
	}
	return VolumesJSON(vols), true
}
