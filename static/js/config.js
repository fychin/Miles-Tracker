/* ── Static data ─────────────────────────────────────────────── */
const API = window.location.origin;

const FFP = [
  {id:'krisflyer',  name:'KrisFlyer',        airline:'Singapore Airlines',                 code:'SQ',    alliance:'Star Alliance',  color:'#003366',
   logo:'https://www.gstatic.com/flights/airline_logos/70px/SQ.png',
   award:'https://www.singaporeair.com/en_UK/sg/plan-travel/krisflyer/use-miles/book-award-flights/krisflyer-award-chart/'},
  {id:'mileageplus',name:'MileagePlus',       airline:'United Airlines',                   code:'UA',    alliance:'Star Alliance',  color:'#002379',
   logo:'https://www.gstatic.com/flights/airline_logos/70px/UA.png',
   award:'https://www.united.com/en/us/fly/mileageplus/awards/award-chart.html'},
  {id:'aeroplan',   name:'Aeroplan',          airline:'Air Canada',                        code:'AC',    alliance:'Star Alliance',  color:'#D00000',
   logo:'https://www.gstatic.com/flights/airline_logos/70px/AC.png',
   award:'https://www.aircanada.com/aeroplan/redeem/aviation/air-canada/'},
  {id:'avios',      name:'Avios',             airline:'Qatar / Finnair / British Airways', code:'QR',    alliance:'Oneworld',       color:'#8A1538',
   logo:'https://www.gstatic.com/flights/airline_logos/70px/QR.png',
   award:'https://www.britishairways.com/en-gb/executive-club/spending-avios/avios-reward-flights'},
  {id:'asiamiles',  name:'Asia Miles',        airline:'Cathay Pacific',                   code:'CX',    alliance:'Oneworld',       color:'#005D63',
   logo:'https://www.gstatic.com/flights/airline_logos/70px/CX.png',
   award:'https://www.cathaypacific.com/cx/en_HK/asia-miles/use-miles/flights/redeem-flights.html'},
  {id:'flyingblue', name:'Flying Blue',       airline:'Air France & KLM',                 code:'AF/KL', alliance:'SkyTeam',       color:'#00A1E9',
   logo:'https://www.gstatic.com/flights/airline_logos/70px/KL.png',
   award:'https://www.flyingblue.com/en/spend/flights/rewards'},
  {id:'lifemiles',  name:'Lifemiles',         airline:'Avianca',                          code:'AV',    alliance:'Star Alliance',  color:'#FF6600',
   logo:'https://www.gstatic.com/flights/airline_logos/70px/AV.png',
   award:'https://www.lifemiles.com/miles/bonus/'},
  {id:'skywards',   name:'Emirates Skywards', airline:'Emirates',                         code:'EK',    alliance:'Independent',   color:'#D70000',
   logo:'https://www.gstatic.com/flights/airline_logos/70px/EK.png',
   award:'https://www.emirates.com/english/skywards/redeeming-miles/flights/'},
  {id:'atmos', name:'Atmos', airline:'Alaska Airlines',                                   code:'AS',    alliance:'Oneworld',      color:'#054687',
   logo:'https://www.gstatic.com/flights/airline_logos/70px/AS.png',
   award:'https://alaskaair.com/benefits/econawardchart'},
];

const ALLIANCES = ['Star Alliance','Oneworld','SkyTeam','Independent'];
const AC = {
  'Star Alliance': {bg:'#dde9f6', fg:'#5B5C5E'},
  'Oneworld':      {bg:'#f5e6e6', fg:'#2A248C'},
  'SkyTeam':       {bg:'#ddedf9', fg:'#004a96'},
  'Independent':   {bg:'#f8f0db', fg:'#8a5e0a'},
};

const BANK = [
  {id:'citiRewards', name:'Citi Rewards Points',    bank:'Citi',               logo:'https://www.google.com/s2/favicons?domain=citibank.com.sg&sz=64', fp:25000, tm:10000},
  {id:'citiMiles',   name:'Citi Miles',             bank:'Citi',               logo:'https://www.google.com/s2/favicons?domain=citibank.com.sg&sz=64',  fp:10000, tm:10000},
  {id:'uobUni',      name:'UOB UNI$',               bank:'UOB',                logo:'https://www.google.com/s2/favicons?domain=uob.com.sg&sz=64',        fp:5000,  tm:10000},
  {id:'hsbcPoints',  name:'HSBC Points',            bank:'HSBC',               logo:'https://www.google.com/s2/favicons?domain=hsbc.com.sg&sz=64',       fp:5,     tm:2},
  {id:'dbsPoints',   name:'DBS Points',             bank:'DBS',                logo:'https://www.google.com/s2/favicons?domain=dbs.com.sg&sz=64',        fp:5000,  tm:10000},
  {id:'ocbcDollar',  name:'OCBC$',                  bank:'OCBC',               logo:'https://www.google.com/s2/favicons?domain=ocbc.com.sg&sz=64',          fp:10000, tm:2900.232},
  {id:'ocbc90n',     name:'OCBC 90°N Miles',        bank:'OCBC',               logo:'https://www.google.com/s2/favicons?domain=ocbc.com.sg&sz=64',          fp:1000,  tm:750.188},
  {id:'ocbcVoyage',  name:'OCBC VOYAGE Miles',      bank:'OCBC',               logo:'https://www.google.com/s2/favicons?domain=ocbc.com.sg&sz=64',          fp:1,     tm:1},
  {id:'sc360',       name:'SC 360° Points',         bank:'Standard Chartered', logo:'https://www.google.com/s2/favicons?domain=sc.com&sz=64',            fp:5000,  tm:2000},
  {id:'amexMR',      name:'Amex Membership Rewards',bank:'American Express',   logo:'https://www.google.com/s2/favicons?domain=americanexpress.com&sz=64', fp:550,  tm:250},
  {id:'amexPlat',    name:'Amex Platinum Points',   bank:'American Express',   logo:'https://www.google.com/s2/favicons?domain=americanexpress.com&sz=64', fp:500,  tm:250},
  {id:'maybankTreat',name:'Maybank TREATS Points',  bank:'Maybank',            logo:'https://www.google.com/s2/favicons?domain=maybank.com&sz=64',    fp:5000,  tm:1000},
];

const CABINS = [
  {id:'F', label:'First',           cls:'cabin-F'},
  {id:'J', label:'Business',        cls:'cabin-J'},
  {id:'W', label:'Premium Economy', cls:'cabin-W'},
  {id:'Y', label:'Economy',         cls:'cabin-Y'},
];
