// assets/themes/obsidian.json
var id = "obsidian";
var name = "黑曜";
var en = "Obsidian";
var desc = "近黑紫调底色与长春花紫强调的暗色主题。";
var scheme = "dark";
var bg = "#0b0b0e";
var surface = "#111114";
var surface2 = "#19181b";
var line = "#202023";
var line2 = "#303033";
var fg1 = "#e8e7ec";
var fg2 = "#cdcdd1";
var fg3 = "#a6a5aa";
var fg4 = "#8d8d91";
var accent = "#b2b1ff";
var info = "#8fbde5";
var ok = "#89c7ab";
var warn = "#d2b281";
var danger = "#e29c9b";
var ext = "#a6a5aa";
var tones = [
	"#e1e0e8",
	"#afaff6",
	"#98979e",
	"#8080b5",
	"#636269",
	"#5d58a6"
];
var style = {
	"numberFont": "mono",
	"numberStyle": "decimal-leading-zero",
	"blockBackground": "transparent",
	"nodeBackground": "surface2",
	"codeBackground": "node",
	"radius": 8,
	"smallRadius": 6,
	"soft": .11
};
var obsidian_default = {
	id,
	"extends": "paper",
	name,
	en,
	desc,
	order: 30,
	scheme,
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
	"new": "#c8aadb",
	info,
	ok,
	warn,
	danger,
	ext,
	tones,
	style
};
export { accent, bg, danger, obsidian_default as default, desc, en, ext, fg1, fg2, fg3, fg4, id, info, line, line2, name, ok, scheme, style, surface, surface2, tones, warn };
