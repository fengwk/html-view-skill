// assets/themes/tokyo.json
var id = "tokyo";
var name = "夜都";
var en = "Tokyo Night";
var desc = "Tokyo Night 靛蓝夜色主题。";
var bg = "#1a1b26";
var surface = "#16161e";
var surface2 = "#24283b";
var line = "#292e42";
var line2 = "#3b4261";
var fg1 = "#c8d1f5";
var fg2 = "#a9b1d6";
var fg3 = "#9aa5ce";
var fg4 = "#8a92c0";
var accent = "#7aa2f7";
var info = "#6bc8f0";
var ok = "#a7c87e";
var warn = "#e3b06b";
var danger = "#ef8d9d";
var ext = "#9aa5ce";
var tones = [
	"#d9e1f6",
	"#81aaf7",
	"#9198ab",
	"#6686c0",
	"#61687a",
	"#3966bc"
];
var style = {
	"numberColor": "accent",
	"blockBackground": "surface",
	"radius": 4,
	"smallRadius": 3,
	"soft": .13
};
var tokyo_default = {
	id,
	"extends": "obsidian",
	name,
	en,
	desc,
	order: 40,
	bg,
	surface,
	surface2,
	line,
	line2,
	fg1,
	fg2,
	fg3,
	fg4,
	accent,
	"new": "#c5abf4",
	info,
	ok,
	warn,
	danger,
	ext,
	tones,
	style
};
export { accent, bg, danger, tokyo_default as default, desc, en, ext, fg1, fg2, fg3, fg4, id, info, line, line2, name, ok, style, surface, surface2, tones, warn };
