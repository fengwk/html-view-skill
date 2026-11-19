// assets/themes/kanagawa.json
var id = "kanagawa";
var name = "神奈川";
var en = "Kanagawa";
var desc = "复古暖调与米白文字的暗色主题。";
var scheme = "dark";
var bg = "#1b1816";
var surface = "#221f1d";
var surface2 = "#2b2825";
var line = "#312e2b";
var line2 = "#46423f";
var fg1 = "#f0e5cf";
var fg2 = "#d9ceb8";
var fg3 = "#b4aa94";
var fg4 = "#9c937e";
var accent = "#8ba9be";
var info = "#74bfba";
var ok = "#a9b781";
var warn = "#e1a583";
var danger = "#d5878a";
var ext = "#b4aa94";
var tones = [
	"#e8e1d1",
	"#d4b771",
	"#9e9889",
	"#99844f",
	"#716b5e",
	"#866700"
];
var style = {
	"numberColor": "tone2",
	"listMarker": "fg4",
	"nodeBackground": "surface2",
	"codeBackground": "node",
	"radius": 2,
	"smallRadius": 2,
	"soft": .12
};
var kanagawa_default = {
	id,
	"extends": "claude",
	name,
	en,
	desc,
	order: 50,
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
	"new": "#cb9fc6",
	info,
	ok,
	warn,
	danger,
	ext,
	tones,
	tint: null,
	style
};
export { accent, bg, danger, kanagawa_default as default, desc, en, ext, fg1, fg2, fg3, fg4, id, info, line, line2, name, ok, scheme, style, surface, surface2, tones, warn };
