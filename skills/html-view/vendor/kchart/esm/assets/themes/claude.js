// assets/themes/claude.json
var id = "claude";
var name = "陶土";
var en = "Claude";
var desc = "Claude 经典亮色：象牙白底、暖近黑字、陶土色文字与编号、衬线标题。";
var bg = "#faf9f5";
var surface = "#f5f4ed";
var surface2 = "#efede6";
var line = "#e8e6dc";
var line2 = "#dad9d4";
var fg1 = "#141413";
var fg2 = "#3d3d3a";
var fg3 = "#5f5e58";
var fg4 = "#6b6961";
var accent = "#a84624";
var info = "#3b6692";
var ok = "#576b3c";
var warn = "#815b26";
var danger = "#96382f";
var ext = "#5f5e58";
var tones = [
	"#2a2621",
	"#bb5a35",
	"#5f5a55",
	"#54220e",
	"#847f7a",
	"#b67f6b"
];
var tint = {
	"hue": 95,
	"chroma": 1.4
};
var style = {
	"displayFont": "\"Noto Serif SC\", \"Noto Serif CJK SC\", \"Source Han Serif SC\", \"Songti SC\", \"STSong\", \"Microsoft YaHei\", sans-serif",
	"displayWeight": 400,
	"numberColor": "accent",
	"listMarker": "tone2",
	"radius": 10,
	"smallRadius": 6,
	"soft": .1
};
var claude_default = {
	id,
	"extends": "paper",
	name,
	en,
	desc,
	order: 10,
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
	"new": "#7c5378",
	info,
	ok,
	warn,
	danger,
	ext,
	tones,
	tint,
	style
};
export { accent, bg, danger, claude_default as default, desc, en, ext, fg1, fg2, fg3, fg4, id, info, line, line2, name, ok, style, surface, surface2, tint, tones, warn };
