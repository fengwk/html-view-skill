// assets/themes/paper.json
var id = "paper";
var name = "素白";
var en = "Paper";
var desc = "纯白底、近黑字、细灰线与蓝色强调。";
var scheme = "light";
var bg = "#ffffff";
var surface = "#f9fafc";
var surface2 = "#f3f4f6";
var line = "#e5e6e8";
var line2 = "#d2d3d5";
var fg1 = "#18191d";
var fg2 = "#35373b";
var fg3 = "#54575b";
var fg4 = "#686a6f";
var accent = "#245fd4";
var info = "#00738e";
var ok = "#307944";
var warn = "#905908";
var danger = "#a83634";
var ext = "#54575b";
var tones = [
	"#23272c",
	"#2769c6",
	"#575b62",
	"#0e3163",
	"#7c8088",
	"#6e92c6"
];
var style = {
	"nodeBackground": "bg",
	"codeBackground": "surface2",
	"soft": .09
};
var paper_default = {
	id,
	name,
	en,
	desc,
	order: 20,
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
	"new": "#72579d",
	info,
	ok,
	warn,
	danger,
	ext,
	tones,
	style
};
export { accent, bg, danger, paper_default as default, desc, en, ext, fg1, fg2, fg3, fg4, id, info, line, line2, name, ok, scheme, style, surface, surface2, tones, warn };
