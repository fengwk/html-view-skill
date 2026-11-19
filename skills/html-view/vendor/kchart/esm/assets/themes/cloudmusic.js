// assets/themes/cloudmusic.json
var id = "cloudmusic";
var name = "云音";
var en = "Cloud Music";
var desc = "纯白底、黑胶墨黑字，以鲜红点亮重点，配酒红与玫瑰金。";
var surface = "#fafafa";
var surface2 = "#f2f2f2";
var line = "#e8e8e8";
var line2 = "#dadada";
var fg1 = "#1d1818";
var fg2 = "#433d3c";
var fg3 = "#655f5e";
var fg4 = "#726b6b";
var accent = "#bc2420";
var info = "#32669a";
var ok = "#397949";
var warn = "#9b641a";
var danger = "#921f3c";
var ext = "#655f5e";
var tones = [
	"#261e1e",
	"#d82420",
	"#6a6160",
	"#6d2325",
	"#948b8a",
	"#b37a6c"
];
var frameInk = "#737373";
var style = {
	"numberColor": "accent",
	"listMarker": "accent",
	"radius": 12,
	"smallRadius": 8,
	"soft": .08
};
var cloudmusic_default = {
	id,
	"extends": "paper",
	name,
	en,
	desc,
	order: 70,
	surface,
	surface2,
	line,
	line2,
	fg1,
	fg2,
	fg3,
	fg4,
	accent,
	"new": "#7d4d8c",
	info,
	ok,
	warn,
	danger,
	ext,
	tones,
	frameInk,
	style
};
export { accent, danger, cloudmusic_default as default, desc, en, ext, fg1, fg2, fg3, fg4, frameInk, id, info, line, line2, name, ok, style, surface, surface2, tones, warn };
