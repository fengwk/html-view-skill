KChartUnits["diagram/shapes"]=(function(e){Object.defineProperty(e,Symbol.toStringTag,{value:`Module`});var t=`rect proc process rectangle
rounded event
stadium terminal pill
fr-rect subprocess subproc framed-rectangle subroutine
cyl db database cylinder
datastore data-store
folder directory
bucket
console
browser
person
circle circ
bang
cloud
diam decision diamond question
hex hexagon prepare
lean-r lean-right in-out
lean-l lean-left out-in
trap-b priority trapezoid-bottom trapezoid
trap-t manual trapezoid-top inv-trapezoid
dbl-circ double-circle
text
notch-rect card notched-rectangle
lin-rect lined-rectangle lined-process lin-proc shaded-process
sm-circ start small-circle
fr-circ stop framed-circle
fork join
hourglass collate
brace comment brace-l
brace-r
braces
bolt com-link lightning-bolt
doc document
delay half-rounded-rectangle
h-cyl das horizontal-cylinder
lin-cyl disk lined-cylinder
curv-trap curved-trapezoid display
div-rect div-proc divided-rectangle divided-process
tri extract triangle
win-pane internal-storage window-pane
f-circ junction filled-circle
notch-pent loop-limit notched-pentagon
flip-tri manual-file flipped-triangle
sl-rect manual-input sloped-rectangle
docs documents st-doc stacked-document
st-rect procs processes stacked-rectangle
bow-rect stored-data bow-tie-rectangle
cross-circ summary crossed-circle
tag-doc tagged-document
tag-rect tagged-rectangle tag-proc tagged-process
flag paper-tape
odd
lin-doc lined-document
state
choice
note
composite
icon
anchor`.split(`
`).map(e=>e.split(` `)),n=new Map(t.flatMap(e=>e.map(t=>[t,e[0]]))),r=[...n.keys()],i=e=>n.get(e)??null,a=e=>e===`round`?`rounded`:i(e),o={diam:[[.5,0],[1,.5],[.5,1],[0,.5]],hex:[[.14,0],[.86,0],[1,.5],[.86,1],[.14,1],[0,.5]],"lean-r":[[.14,0],[1,0],[.86,1],[0,1]],"lean-l":[[0,0],[.86,0],[1,1],[.14,1]],"trap-b":[[.14,0],[.86,0],[1,1],[0,1]],"trap-t":[[0,0],[1,0],[.86,1],[.14,1]],tri:[[.5,0],[1,1],[0,1]],"flip-tri":[[0,0],[1,0],[.5,1]],"notch-pent":[[.14,0],[.86,0],[1,.23],[1,1],[0,1],[0,.23]],"sl-rect":[[0,.24],[1,0],[1,1],[0,1]],"notch-rect":[[.14,0],[1,0],[1,1],[0,1],[0,.25]],odd:[[0,0],[1,0],[1,1],[0,1],[.16,.5]],hourglass:[[0,0],[1,0],[.55,.5],[1,1],[0,1],[.45,.5]],bolt:[[1,0],[.4,.44],[1,.44],[0,1],[.6,.56],[0,.56]],folder:[[0,0],[.37,0],[.46,.19],[1,.19],[1,1],[0,1]]},s=[[0,0],[1,0],[1,1],[0,1]],c=(e,t,n,r,i,a,o=12)=>Array.from({length:o+1},(s,c)=>{let l=(i+(a-i)*c/o)*Math.PI/180;return[e+n*Math.cos(l),t+r*Math.sin(l)]}),l=(e,t=!1)=>Array.from({length:17},(n,r)=>{let i=(t?16-r:r)/16;return[i,e+.09*Math.sin(i*2*Math.PI)]}),u=new Map([[`sm-circ`,[14,14]],[`f-circ`,[14,14]],[`fr-circ`,[16,16]],[`cross-circ`,[36,36]],[`anchor`,[2,2]],[`hourglass`,[30,30]],[`bolt`,[24,48]],[`fork`,[70,10]]]),d=(e,t)=>{let n=u.get(e);return n&&e===`fork`&&[`LR`,`RL`].includes(t)?[n[1],n[0]]:n};function f(e,t,n,r){let i=d(e,r);if(!i)return null;let a=Math.min(t,i[0]),o=Math.min(n,i[1]);return{x:(t-a)/2,y:(n-o)/2,w:a,h:o}}function p(e,t,n,r,i){let a=d(e,r);return a?i?[a[0]+(t-20)*2,a[1]+(n-12)*2]:a:[`diam`,`choice`].includes(e)?[t*1.7,n*1.7]:[`tri`,`flip-tri`].includes(e)?[t*2,n*2]:[`circle`,`dbl-circ`].includes(e)?[,,].fill(Math.hypot(t,n)+(e===`dbl-circ`?10:0)):[`person`,`bang`,`cloud`].includes(e)?[t*1.6,n*1.7]:[`rect`,`rounded`,`state`,`note`,`composite`,`text`,`icon`].includes(e)?[t,n]:[t+24,n+12]}function m(e,t,n,r){let{x:i,y:a,w:u,h:d}=f(e,t,n,r)??{x:0,y:0,w:t,h:n},p=o[e===`choice`?`diam`:e];if(!p){let t=Math.min(8,d/2,u/2),n=t/u,r=t/d;if([`rounded`,`state`,`browser`,`console`,`note`,`composite`].includes(e))p=[...c(1-n,r,n,r,-90,0),...c(1-n,1-r,n,r,0,90),...c(n,1-r,n,r,90,180),...c(n,r,n,r,180,270)];else if([`stadium`,`delay`,`curv-trap`].includes(e)){let t=Math.min(.5,d/(2*u));p=[...c(1-t,.5,t,.5,-90,90),...e===`stadium`?c(t,.5,t,.5,90,270):[[0,1],...e===`curv-trap`?[[.14,.5]]:[],[0,0]]]}else if([`circle`,`dbl-circ`,`cross-circ`,`fr-circ`,`sm-circ`,`f-circ`,`anchor`].includes(e))p=c(.5,.5,.5,.5,0,360,64).slice(0,-1);else if([`cyl`,`lin-cyl`,`bucket`].includes(e))p=[...c(.5,.12,.5,.12,180,360),...c(.5,.88,e===`bucket`?.38:.5,.12,0,180)];else if(e===`h-cyl`)p=[...c(.88,.5,.12,.5,-90,90),...c(.12,.5,.12,.5,90,270)];else if(e===`st-rect`||e===`docs`){let t=5/u,n=5/d,r=e===`docs`?.9:1,i=e===`docs`?l(.9,!0).map(([e,r])=>[e*(1-2*t),2*n+r*(1-2*n)]):[[1-2*t,1],[0,1]];p=[[0,2*n],[t,2*n],[t,n],[2*t,n],[2*t,0],[1,0],[1,r*(1-2*n)],[1-t,r*(1-2*n)],[1-t,n+r*(1-2*n)],[1-2*t,n+r*(1-2*n)],...i]}else if([`doc`,`lin-doc`,`tag-doc`,`flag`].includes(e))p=[...e===`flag`?l(.1):[[0,0],[1,0]],...l(.9,!0)];else if(e===`bow-rect`){let e=Array.from({length:17},(e,t)=>{let n=t/16;return[1-.075*Math.sin(Math.PI*n),n]});p=[...e,...e.map(([e,t])=>[e-.925,1-t])]}else p=e===`bang`||e===`cloud`?Array.from({length:96},(t,n)=>{let r=n*Math.PI/48,i=e===`cloud`?.46+.04*Math.cos(7*r):n%8==0?.5:.37+.13*Math.abs(n%8-4)/4;return[.5+i*Math.cos(r),.5+i*Math.sin(r)]}):e===`person`?[...c(.5,.2,.19,.2,130,410,32),[.61,.39],[.8,.44],[.96,.58],[1,.8],[1,1],[0,1],[0,.8],[.04,.58],[.2,.44],[.39,.39]]:s}return p.map(([e,t])=>[i+e*u,a+t*d])}function h(e,t,n){let r=t===`top`||t===`bottom`,i=+!r,a=1-i,o=e.map(e=>e[i]),s=Math.min(...o),c=Math.max(...o),l=Math.max(s+.001,Math.min(c-.001,n)),u=[];e.forEach((t,n)=>{let r=e[(n+1)%e.length];(t[i]<=l&&r[i]>l||r[i]<=l&&t[i]>l)&&u.push(t[a]+(r[a]-t[a])*(l-t[i])/(r[i]-t[i]))});let d=t===`top`||t===`left`?Math.min(...u):Math.max(...u);return r?{x:l,y:d}:{x:d,y:l}}return e.flowOutlineName=a,e.outlinePort=h,e.shapeGlyphBox=f,e.shapeName=i,e.shapeNames=r,e.shapeOutline=m,e.shapeSize=p,e})({});
