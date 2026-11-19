export class PeriodError extends Error { constructor(code,message,fix){super(message);this.name='PeriodError';this.code=code;this.fix=fix;} }
const RE=/^(\d{4})-(0[1-9]|1[0-2])$/;
export function parseMonth(value){const m=RE.exec(String(value??''));return m?{year:Number(m[1]),month:Number(m[2]),text:`${m[1]}-${m[2]}`}:null;}
export function shiftMonth(value,delta){const p=parseMonth(value);if(!p)throw new PeriodError('BAD_PERIOD',`月份 ${JSON.stringify(value)} 不是 YYYY-MM`,'使用公历 YYYY-MM');const i=p.year*12+p.month-1+delta,y=Math.floor(i/12),m=i%12+1;if(y<1||y>9999)throw new PeriodError('BAD_PERIOD',`月份 ${value} 偏移后超出可表示范围`,'把月份限制在 0001-01 至 9999-12');return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}`;}
export function compareMonth(current,kind){if(kind==='mom')return shiftMonth(current,-1);if(kind==='yoy')return shiftMonth(current,-12);throw new PeriodError('BAD_PERIOD',`未知比较 ${JSON.stringify(kind)}`,'compare 只接受 mom 与 yoy');}
export function assertTimezone(timezone){try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format(new Date(0));return timezone;}catch{throw new PeriodError('BAD_TIMEZONE',`未知时区 ${timezone}`,'使用 IANA 时区名，如 Asia/Shanghai');}}
