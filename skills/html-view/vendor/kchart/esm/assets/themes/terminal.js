// assets/themes/terminal.json
var id = "terminal";
var name = "终端";
var en = "Terminal";
var desc = "黑绿终端风与荧光绿强调的暗色主题。";
var bg = "#0a0e0b";
var surface = "#0e1410";
var surface2 = "#142018";
var line = "#1c2b21";
var line2 = "#2a4233";
var fg1 = "#e2f5e7";
var fg2 = "#bdd7c4";
var fg3 = "#93b39d";
var fg4 = "#7c9c86";
var accent = "#5af78e";
var info = "#80c5ff";
var ok = "#0bdac9";
var warn = "#e7b643";
var danger = "#ff8a82";
var ext = "#93b39d";
var tones = [
	"#d8e5da",
	"#6de18b",
	"#909c92",
	"#439b5b",
	"#5c675d",
	"#007232"
];
var style = {
	"radius": 0,
	"smallRadius": 0,
	"soft": .12
};
var terminal_default = {
	id,
	"extends": "tokyo",
	name,
	en,
	desc,
	order: 60,
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
	"new": "#d9a4ff",
	info,
	ok,
	warn,
	danger,
	ext,
	tones,
	style
};
export { accent, bg, danger, terminal_default as default, desc, en, ext, fg1, fg2, fg3, fg4, id, info, line, line2, name, ok, style, surface, surface2, tones, warn };
