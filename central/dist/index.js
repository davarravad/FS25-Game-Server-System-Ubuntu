var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/security.ts
var roles = ["pending", "viewer", "operator", "admin"];
function allowed(role, required) {
  return roles.indexOf(role) >= roles.indexOf(required);
}
__name(allowed, "allowed");
function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(randomToken, "randomToken");
async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(digest, "digest");
function cookieValue(request, name) {
  const values = (request.headers.get("Cookie") || "").split(";").map((s) => s.trim()).filter((s) => s.startsWith(name + "="));
  return values.length === 1 ? values[0].slice(name.length + 1) : "";
}
__name(cookieValue, "cookieValue");
function cookie(name, value, seconds) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
}
__name(cookie, "cookie");
function validId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}
__name(validId, "validId");
function validScope(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
__name(validScope, "validScope");
function safeMetrics(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(["cpu_percent", "memory_used_bytes", "memory_limit_bytes", "disk_used_bytes", "disk_limit_bytes", "network_in_bytes_sec", "network_out_bytes_sec", "uptime_seconds"].map((key) => {
    const n = source[key];
    return [key, typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e18 ? n : null];
  }));
}
__name(safeMetrics, "safeMetrics");
async function readJson(request, limit = 262144) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error("Body too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Expected object");
  return result;
}
__name(readJson, "readJson");

// node_modules/entities/dist/decode-codepoint.js
var c1 = [
  8364,
  0,
  8218,
  402,
  8222,
  8230,
  8224,
  8225,
  710,
  8240,
  352,
  8249,
  338,
  0,
  381,
  0,
  0,
  8216,
  8217,
  8220,
  8221,
  8226,
  8211,
  8212,
  732,
  8482,
  353,
  8250,
  339,
  0,
  382,
  376
];
function isInvalidCodePoint(codePoint) {
  return codePoint === 0 || codePoint >= 55296 && codePoint <= 57343 || codePoint > 1114111;
}
__name(isInvalidCodePoint, "isInvalidCodePoint");
function replaceCodePoint(codePoint) {
  if (isInvalidCodePoint(codePoint)) {
    return 65533;
  }
  if (codePoint >= 128 && codePoint <= 159) {
    return c1[codePoint - 128] || codePoint;
  }
  return codePoint;
}
__name(replaceCodePoint, "replaceCodePoint");
function codePointToString(codePoint) {
  return codePoint - 1 >>> 0 < 127 || codePoint - 160 >>> 0 < 55136 ? String.fromCharCode(codePoint) : String.fromCodePoint(replaceCodePoint(codePoint));
}
__name(codePointToString, "codePointToString");

// node_modules/entities/dist/internal/decode-shared.js
var BASE91_INVERSE = /* @__PURE__ */ (() => {
  const table = new Uint8Array(127);
  let code = 0;
  for (let char = 33; char <= 126; char++) {
    if (char !== 34 && char !== 36 && char !== 92) {
      table[char] = code++;
    }
  }
  return table;
})();
function decodeTrieDict(input, resultLength, atomCount, dict1AtomCount, ngramCount, dictSize) {
  const base = 91;
  const inputLength = input.length;
  const twoCharBias = dictSize * (base - 1);
  let pos = 0;
  const readSlotCode = /* @__PURE__ */ __name(() => {
    const c12 = BASE91_INVERSE[input.charCodeAt(pos++)];
    return c12 < dictSize ? c12 : c12 * base - twoCharBias + BASE91_INVERSE[input.charCodeAt(pos++)];
  }, "readSlotCode");
  const dict2AtomCount = atomCount - dict1AtomCount;
  const slotCount = atomCount + ngramCount;
  const single = new Int32Array(slotCount);
  single.fill(-1, dict1AtomCount, dictSize);
  single.fill(-1, dictSize + dict2AtomCount, slotCount);
  const start = new Int32Array(slotCount);
  const length = new Int32Array(slotCount);
  function decodeDelta(count, off) {
    let previous = 0;
    let slot = off;
    const end = off + count;
    while (slot < end) {
      const code = BASE91_INVERSE[input.charCodeAt(pos++)];
      if (code < 89) {
        previous += code;
        single[slot++] = previous;
      } else if (code === 89) {
        let runLength = BASE91_INVERSE[input.charCodeAt(pos++)] + 2;
        while (runLength--)
          single[slot++] = ++previous;
      } else {
        const next = BASE91_INVERSE[input.charCodeAt(pos++)];
        previous += 89 + // eslint-disable-next-line unicorn/prefer-minimal-ternary -- branches read a different number of side-effecting input bytes
        (next < 90 ? next * base + BASE91_INVERSE[input.charCodeAt(pos++)] : BASE91_INVERSE[input.charCodeAt(pos++)] * 8281 + BASE91_INVERSE[input.charCodeAt(pos++)] * base + BASE91_INVERSE[input.charCodeAt(pos++)]);
        single[slot++] = previous;
      }
    }
  }
  __name(decodeDelta, "decodeDelta");
  decodeDelta(dict1AtomCount, 0);
  decodeDelta(dict2AtomCount, dictSize);
  const references = new Int32Array(ngramCount * 2);
  let poolSize = 0;
  let ngramIndex = 0;
  function readNgramReferences(count, startSlot) {
    for (let index = 0; index < count; index++) {
      const slot = startSlot + index;
      const a = readSlotCode();
      const b = readSlotCode();
      references[ngramIndex * 2] = a;
      references[ngramIndex * 2 + 1] = b;
      ngramIndex += 1;
      start[slot] = poolSize;
      const entryLength = (single[a] < 0 ? length[a] : 1) + (single[b] < 0 ? length[b] : 1);
      length[slot] = entryLength;
      poolSize += entryLength;
    }
  }
  __name(readNgramReferences, "readNgramReferences");
  readNgramReferences(ngramCount - dictSize + dict1AtomCount, dictSize + dict2AtomCount);
  readNgramReferences(dictSize - dict1AtomCount, dict1AtomCount);
  const pool = new Uint16Array(poolSize);
  let write = 0;
  for (let index = 0; index < ngramIndex; index++) {
    for (let half = 0; half < 2; half++) {
      const source = references[index * 2 + half];
      const value = single[source];
      if (value < 0) {
        let read = start[source];
        const readEnd = read + length[source];
        while (read < readEnd)
          pool[write++] = pool[read++];
      } else {
        pool[write++] = value;
      }
    }
  }
  const out = new Uint16Array(resultLength);
  let outIndex = 0;
  while (pos < inputLength) {
    let slot = BASE91_INVERSE[input.charCodeAt(pos++)];
    if (slot >= dictSize) {
      slot = slot * base - twoCharBias + BASE91_INVERSE[input.charCodeAt(pos++)];
    }
    const value = single[slot];
    if (value < 0) {
      let read = start[slot];
      const readEnd = read + length[slot];
      while (read < readEnd)
        out[outIndex++] = pool[read++];
    } else {
      out[outIndex++] = value;
    }
  }
  return out;
}
__name(decodeTrieDict, "decodeTrieDict");

// node_modules/entities/dist/generated/decode-data-html.js
var htmlDecodeTree = /* @__PURE__ */ decodeTrieDict("!}.&u%}'&}*'~!6*)%&,~!J~!J~%L~y<~!R,~~%Lu~~#GD~~#|)1#%}^%}2%+#.##%##%}&%##%'#%##&%#%#'%#&#%#&#'#%%#&#%##%#)%''%&%#%#'%#%%#%%}%%%#%#&(23#%%#&-%0%('1#(##%#'##+%'*.:1}#%#6-+(%'%%#%%%}#L'2351&('%}&/N'(0(/*-%(%%}#'+&T%7.2}#&%&#%#36/5##%&%%#&#%%#))2%%##%&&'0~!#*+&'%1~!%).'3q?&%'1~!.##%6(~!+%%%(Gw'rT~!E#<nA%#jZ~!H%(~!42##~!*31&~!G%U~#)5~#`3~!J~!Z~%]~%Y~%C~!q~!u~#kz~%#~!6'~!D~!U~!?~#T~!c%~!G#'~%7|~!G~!J~!G&~#pb~(Df}#%}*&}#%##%##%##&#-}&'#'&%#.++}%mI,#,@&(}*%}*'%&##&#%##%}&0}#.},U},%}+%}&%}#%##&}B%(}(%}+%)})%##%#&}&%##%&}<%}>%#%&}*%}(%}9%}/%})%}*%}*%}?&}&%}3%}&*#%})%#%#)}#&#-#+*%E%%'%'#%}#*V##&##I}#&&##%&%#&&Qf%%))w/0+&%#(#.%-''''++++7}>%4'',##1,#%#&%##&#'##&#*#9)%&%}#*}%,#+P(%A&%#'&##wSD',9E00#y#@}(+}&%&>~!#~!X}#*}(&&}(&}(,%}%&#+&}#&}I%#%}%)#(},'%#*}4%%#%}(''}#/##(##),%-##%%)#&}(.}&%#&}%%}*&#%},&&}&%}#%*'#%})%}D&}&%}-&}6&#&}-,%}#%})-(~+`~,=?~I9'9%~!,#%})%})%}@%}?%}(~!?~#<~#pP~#BG~#=1#%K+~#?#~%;)~#A~#mF1~#A'~'X%'~#lR~#N~'N~#r~#m#-~#i'?%#'%~#B%##%,%#~#_%#0%~#]732~,w~2+#:&#%&'0%&>%}#>##F+)#%&&#(+_}4&}-%}(&}@&}O7Fdf0@+/v4}&WU##&/0#&'('B#%}.%}'+#%}#%%&#&%#%##+#&#)#6#'#.},%}c%},%#%##%&#&%#&~#>'*-.%##%##%}#%%}%'~#)D1}#%*&~#_%%'(~#S2%'.}#~#=##*'*-%}&'%'##&&~'E%.#&~#M4}%%##&'%#~#O1##%&#'+~#<B%##%%'%+~#;#@%}#&%#&&%#(~#H1}'%'##&&~#?A}&'~#D#%32}'&&&&~#[}'(#%}'~#;C})&}%%#%~#=&%,3}%'(#%%~#^'#&&)#%'~#Y%-~#d-%'~#^%%&#&&&}#~#b~2t*&'~&(~&@~0%~e~3}%*''0})&}+~!9##-}#%-hD*)1fC#%/&/fB#40~!+#)*4~!+~!K'&:~!/*7~!.#~!H~!L':~%x&~!H#~!*~%1~!I#~!+A~#p'~!F~~#-#~,,(~.Z~!V~%;'B'mq-W~!N~%I%#&&#&}#%},%%}'%}+X#%}#&}(%}'%}<%}#%}%%'}'%}:~![)9@~%>~#UA%-%##&~!C%~!-.9:~!1~!-^2/:a~!y,D*J#-5)/4~%23,~#G~!L1~!0X3`~!2+~!!0-~&E~!W~!o,>Y&]~%cZx_&~#O*9#A#'#+I'%#)~!0B*-5A+-((F&*M#)(-7-5+'-3a5Vi~!Y~!?+[)%3),ERHm~!+:D,VG.+)?fB%%*(%)'(#&80%1'8`K8?`+'Z#&O&'H5#*9)A%%5&3))0%39+.*7#()&&*=4@**L)<'_&*+..;(#*+)./&0#3)%')-8(4ixD(&.}%,('aI:,)%,k2231T)I'#/-W7,/'Q#.'Y24+h')37</31&83##&0#),H(?'&?/1##%#&&#%''-%&&&#(&''&#.-'%#%%(,')*'&#&#'##%(%(#%('#&##%%%%('%#%#%%#%#&%##h>w+v<ayvyvcg.uuhKr}g/v|g>u9i[~>g5uI~=RvdwEg;v/g;uk!!TTSx]@RT!U!#!@VBRUU!'UTe-d0c`e&gSdicedFcrdTaqb.kYcAohdYd@a3e+d}dMdtd.aJ#bqcK`dle/e.e'dwdPdodddjbEb}ogd^ofdpduc6j?l%d{drdqc)d7bacOdQ%T#Y)X.sR[yH>6Vyv3[xwLu>vo'!*.[yBacahoj>6Rew3[xqdZa#!a&#^(X-[yG>6Vyu3[xvg3sEr|g.u/Ri9db0T#^(Xa)!-[y;>6Vylg4wKs{JwNZt3@3r=c4Z([xlg;wKt!cpq's@v7A'*a(a+!-a#[y<3Dt?3Dt'>6Vym3[xmg9rxsNJwLZt4~?r?db1T#`-!(Xa,!0[yS>6Vz%NuQs.g4wKtnJwNZtS@3r>c4Z([y%g;wKtrdga8!a(!#&T*Y-Xa#!a0<or[yc3Dtq>6Vz43[y3JwNZtf@3s!Ju}!%Dti:pm3c_%X#tjB5pkd6q!r]u?voC'*-a.a2!0a&a+[yI3DtI3Ds~3DtH>6Vyw3[xx;:s#~<5pKJwNZtE@3r~d`a)!a2T#a.(!+U.X1[yT3Dt`3Dtv>6Vz&3[y&g9rxwzcxstPu.<rAJwLZtT~?r@dZa%!a.&^*Za(/Reu[ya>6Vz23[y1g3sEr}wkg{NuQRg{ci(U#5@b`~,cg#U(2WnH5wugcRh7dX#T(Y,a'Ta!!a,[yZ<]mj>6Vz,3[y+Pv#5ReZKu+=,%!H}7ABwkaS?Rh:BcW(X#<]mrj:ubv/ARekdg%!(!a.*Ta(Y.X1!#sP>Rl*Dt6[y>>6Vyo3Wf*jOvuumvuRgRJuq*!:9<B@bX~3jVv&v@s@5Re[d/rQt{uAvo&a&a*)a2!,0Wf!3Dt0=Bs'>6Re}3[xy~<5s%JwJZt1~Gs)c;&!#2sJkNuXvzq7rxu,Re8dka4!a8(aEZ+a@Y.X1Xa)[yd=Bs(3DtP>6Vz53[y4cX#X&Re:avRe9~<5s&JwJZtQ~Gs*i^rzvdRg+Jv{%!2sbB@bX}kdga,!Za?&^*T1/!a'Dt+[y6>6Vyf3Wf%g/u;s4hGu6?Rh-JvZ,!c%#&RoX54Rivj7uyvf8RgTKvZB%*!2sGh<vu5Rgq<=C::9bb~#dZ#T&Ta6Y.X*Dt>[y93Wf)coZ(T,6VyifluvRgC@95@B@bX~/hFu34cC#T,k/unq8w8Q5RkUklwQuzunq8w8Q5Rk8d/rJu?v8w9)-&!a0a;a&aIWejg3sEr/h1s<DtDJvyZqY5aws3Jvy!&Wei~Hr1:au5@Bag>23E~5c:Z&bX};kKv?w&unuVu5Rjc;>bs)#~@:Rh.=ay<a]C;b`}Vd6s/t{uAvoaxa()!a,a7%-a#a2Dt,[yF2Wo[>6Vyt3[xuNuPRi&NuPwpi#RoWh?vf8Ri%Jv]!%Ri:KvxD!.'2WeAjZu`q9rxu,Re7woeAg-unLq(qA_/*2Wg_g3u5q^9:4E}/jTrxrzv=Wkkd~0UX#^^Xa-a1a5T&a=U1a'*aEa]!a*aPaA-adok[y54Rn>;:p3~Dp5g9rpsFNvZqjg3uJp4~<5p0Pw;5qlJwNZt*@3p1Pw:5p/Ou!5p2JvG'!6Vye=<qnJvh_[xhg3v,Rh3kOwOw-sDuev/Re^dha[a%!%!a+#Ta7)-5TaCaO!aka!a)sf[yb2>Rl!9ARiq5E}Qg=ucRkBE|oJrJ_@Wk~@Wk{JrJ_@Wk|@WkyJrJ_@Wk}@WkzJvO_[y2g-vMRmiKuYC!)&>Ri;>Ri<@3RkNc](X#@9Rk=g5vuRmhKvDB!+'=]meg3u4Rmgd)#Y'Vz3CARmfd`a+!%T'!+#Ta1Ta6TaM-sTDt9[yA9sYd'%Y#s[[xpj:ueunaXRgEjRq,v-vuqdd2'`#6Rev<32@5>:2<E}5xIo9a*X#Y(;5RePJvD_g>vyRgNj8w)v8<wggs:RgXiZt|vjx,hSq3ah!-(~@:Ro/Ou!5RhWj^v(pyw8unRhUdx-UY#^Ua.a3a70!)%UX1TaDa)'omRiRRhE[y:3Dsz=Br,>6Vyj3[xkg6ruwjcqsrPw;5r*Ku]D'Zt-@3r(~?r.i[vwv]dU1a--U#`a4(g/vsRhPOu!5RhLj:rmu9Wo!~@:wdh@g/vsRiTjXuvvNr}:RhBj^v(pyw8unRn]dz1UYa'a+^Y(!aETZalaRY.Ta?a4[yDJw1!#qLsW>6Vyrfzq-pLflpwRe|Js>%!Dt@3Dt&Jvy_[xs~HrnjMuwpsw'RecKu+D#'!t<~Grl~?rjg5u-x,gwp{ah!-(~@:Rg~Ou!5Rh'jXuvvNr}:Rh#cW#X/c;&!#2sLi[v7u7RgpJv)(!iLrxu,Re6j7v@s@5Se[e7d`aW!Za(a`T.a#!a3!&aDa-!9)Dt_=6s+3[x~~DR|h~DS6avhGun5RkZj3w)v-]mkKunB!&*]kb97R|i<ARk<c:Z(6Vy}Juh'!wziMRoS:F|vkLuauJv5vtvQRh1d='T+Y#VyO~DR|jcF#T'7R|g97R|kJv3'!ay<Rj,Jvh&!:ReXcsa6*a+#a#_aIRf9aLRf?c,Z&Rf5Rf7c.Z&Rf;Rf>cQ#%T'p-Rf8Rf=ct#%'(*!,p,Rf4p+Rf6Rf:Rf<d~'Ua%U*^UYa(!a,-!#a4YaTalaEX0a8a<Weo3Dt/3Dsx=Br93Wen~Dr;~<5p<JwNZt2@3p=Pw:5p;Ou!5r3c7&!#:p>3Ds}KvGB)_6Vyk2sM=<r7x'eovA(!hFu1ARf}cV#X&@r5j6rvwQa^Rf3c=Za'wkghJv__g;unRggA53B9=b^}%j6uduo5Jq;!(hIv%2Re`Ou4ARe_e%a#^^^Xa&!a*a2!&a6YaP!*ad!#a:aE/5Rn?[y@>6Vyp;:pE~DrY~<5pBJwNZt8@3pCh=rt3rWPw:5pAJup_[xoNuPpF9c!#'45pD5ARn)d8#X'X*3@rU72s]h>v<<sSjJpqvewOJq/(!hNw'5ReBk0s2u3w/w'5ReE5@Jq.!a+JQ!&WeU23d(#Y&RjG5]jBk!u7w&u0udARjEe#+^^^Ub#!a2/a`Z(agT1!a-a;|@TaG!aS[yV=Re~fow'RguNuPRe?bz#'>RoUWeL>:Cbb|?JwPZtVg6ruRmzJvD'!6Vz(g/vmRh~Jvy_[y(g9voRgyx*cy(#2>Ri2B9b]~9kIw9u7rluJu3Rg]dI#a%UY'@=p%CAx.gQZ&RhwwygtRm{x5g_Z'+ABqR9Woa=Bp&dV#^*Xa'!&@o{g4v]Rk;Jv{!%Rk[wkkiA5RkiwwfUB=x,fUuqC&*!>RfTg8v0RfV~ARfSd;rJsAuAv9wR'ae+/aO!a@aza/a#[yQ@Wg!2Wemg3sEr0JvB_g>uvReWg2v+Re=KupB_+[y!2AbY~-~Hr2AJwD!(h<~El>h<~El?Kun@+_:9b`}Kg-v/Ri3g;vtwyk_9]k_d=&T#*U.6qh@Ab`|K9:H|CJv[!&3Dtex'fDwC%!Rf[9WlMd[(^X,!a%Z06Vz!@WgBg=v~Rgvg,QRe@awd,#Y+jTv|Q~EfWj]uNr|~FRfXdy#Y&^Ua%!aO.!(a)Ua;=!a@aKap!a-,a!Ta]a[rSa]p?[y82sK=Bq~;:p:~<5p8Pw:5p7d'#Y'Wf(;RnRi[u4w&RgJJvG'!6Vyh=<r#ijuuv/sIKuYD'ZtG@3p9~Gr&d2#`(g<vtRgFj`u5w&rqpxRf2CJuY!+:wfnTOu!5Rg}jNs1ucv&RfwJvA!&3@q|BDcC#T,k/unq8w8Q5RkTklwQuzunq8w8Q5Rk9dga#!a'!a=#a0!:+Tb*b@aO.a4!aba8aFJv^}?!VyR~Dr<g;u%Rn.~<5p[x'e`wNZtR@3p]Pw:5pZhNvjBp.woe_g5u-r4JwF!%DtO3:ooc7&!#:p^3DtpLuGw(!+%)Dtk6Vz#2sd=<r8d'#Y([y#<x3gJt`w@!)%}MRiowzikRij=]ilxAf3,U(#B2Rf#g0v-Rm[ck{`U#]giKv3>)!&6Ri154s,KuGB_%@r68r:dJ|t`#X(9<E|u2@H|rx3gJu?w'!+'1Nu7Reg4=H~+9<wxgY95Rm]xLggZ-`(X}U2:Ri4h<uOawRmsJv__5@bb{jbV~3dka#a'a]!,#a+U=a>b6a3b%!/aKa/)!arwve^VyJ;:pR~DpTg3uJpS~<5pOPw;5qmPw:5pNOu!5pQJvG'!6Vyx=<qoJvA!{~Jup!%@qk7Rn/KvyD!}''[xz;>wkh'?Rh,x8gyt`w5D!&),(SgyccRgztJ@3pPB5p#d'(Y#<]mmifubw&RgoJvE&!82s^JvF&!8Rf,ADb]~;x=h'rNu]vK!,%'*0RnORh)4Rh*AqQg-vaRnNg;wHwkh'ba~4cE#Ta*x3gctyw@'!+%RnFRnD<4Rn@hFvK5RnCxWg[#`&a0Ua()`1Rm75Rg[c]%X#qi8Rg^NvdRj>BwzgZauwji7Rm6A4wgg]d1#&(*,.0a#Rm;Rm<Rm=Rm>Rm?Rm@RmARmBe%#^^^Xaea?aC/b+(,!a+a#!a/!>a&Ta<aKbD!2wphBRnk[yPw}hE|.=Br-3Dtm>6Vy~g6urRf.x,hPrNav!%'RnqRo%Ro#Nu;q[Pw;5r+JwNZtM@3r)d'#Y'Weh;xChL#`&RnmRnoKu}>%(!Rne~Bs-;2wjcussJv+'!aYSO}6@B<5?ba~8LrNvj!.%*ROwungw~ng~:9;Ri^>wtnig;wHRnixDh@|(UZ.x1h@|)!#:2<H|*xHn]#-UX'3Ro)z=iT}6ARns=Bwsn_wpnaRncw]aR(#UXa&Ua*a/=]iPd'#Y&Ro'WnXf{QRm2hNvj]nZd`'T~&1`{|`#9b]{}c:'!#Wl{>@=be}]?cl{{U#:5Abb}Jds#^YaF!a*b4a#a3aPa>&Tb!bH!*a_!Eau?/a&RjY<]gj>6Vz*;:pe~DrZg,QRj1JwNZtX@wihspcJvZ&!VyX9WmOJu|!|N2WmHJvh&!]ht~Bpbcn&T(!#RmQ<s7Nu;padH#X'`+WmJ@>RmKCARhnKup=!)&Wf+:RhqNuPpf9c!#'45pd5AwghpARn(Ls@w!%,)!RmP@Wfe<E|IJva!&WmNg8vsRmLd`*.`#Y'Xa!axRn*]hrA8Rhug5s@rXg8u!RmMd8#X'X*3@rV72smdI*#UY&RmICARho~GsgxVgd)Ta'U-Y&Xa!T#RnEWnA@Wffg1uDRi0hFvK5RnBxGnG&#`%owp)@wsf+bX}Ze-*1!a*^^^Ua|!#a.aq&Ya2!a>.a6!a:aO`aJDtL[y`@Wg#>6Vz12@wzoYRoZNuPRi!NuPRhzg=ucRi,@=b`{Yg=ucRi-ACJvB!&Sh[ebSh]ebi`wUuFRm4Jw2_[y0JvB!.<Ju(!&SoG}6Shd}6<Ju(!&SoH}6She}6Kur@._g5vHRieJvx!{L2G{Kx6gd'T#?Rh82Wi5cZ#X(g1w)Rm5dW-Y(Ta#!a)!#aYa=wnfE=su2>>bU{0j9udv:<svj8uQv-7RgHdE%#^'sq9sp=>Bb_{TJv`!&g/r|snj6v(us5d,#Y(56H}[978H}]Jw5!&g1rushJvB!+j;v{u5?zDhd}6}bj;v{u5?zDhe}6}ce*#`(^^^a[aea!=!a6a*aoXb1a.!aAbL!b>,b'aL!aV@Wf|2Wlg3[y/JwNZt^@3piPw:5pgJunZou3@rsJva&!Vy_g<v~Rm#JvG'!6Vz0=<r{Ju{%!:pj@WfsiXuJu3Rm:JvZ&!WfA~Bph@c4Z&Dtwax5rubx(#:awRk1@d,#Y&RfjRfid1#,Y(@Wfp2Wlrg5s@ryKu[@!,'=]ig9wlk?Rk>g5u-rqJvy'!@9RkQcH(T#=>Ri~@<wkj(Wj(KuZB*!&<7rw@9RkRcH(T#=>Ri}@<wkj)Wj)dg(Ta2Xa9X#`-!a*CARhg@@=I}d9x;c~#X%so=<sj>2@@=aybb}XjWv0Q~EfEj3vLv;<d,#Y(56H}`978H}_dgaPaFa'a/!#a3Y0a_a;a|!1(a7-[yE3[xt;:pJNvZrrg3uJrvJwNZt=@3pIh=rt3rxPw:5pGOu!5rpJvG'!6Vys=<rz@c4Z&Dt(ax5rtJvZ!&~BpH@wsfNg-vaRlNci*U#=<wei<F}a5@Jq.!a*JQ!%@qZ23d(#Y&RjH5]jCk!u7w&u0udARjFd/prq=tyvpaEa(a:.!a1aZ(@@=I}:9wpd%=<sX55w_h}@@=I{t=ay<aU@@=I}T=ay<2@@=I})?C9:9au@9Cb]}DP~=x-fAZ(2Wl1=ay<aU@@=I}>5@d##Y+jTv|vV~EfFj]uNpn~FRfGdgaK!Z2&!a8a-Tb({E!acTbM*!a(DtY[yYd'%Y#sl[y*hHvh>Re5x2c{Z}.j4uCvcawRiMd+#X+_x&d!},<5RkX;2Hzw@x,gavfB-!{CcF&T#Roe;RodwWbBg5urRgaKvHC*_6Vz+<4opieuew&Rmq@d]&Y)X,T#X0Rh}<BqP=4qS9:ReMg/ujReNJw0!/<Jui%!bd{kawwnemRelAxUa?a3#*.&UX(Ya+a/RhvRnQ<o}9Wmtd-#Y&RgSRmw9;Rmxay=Rmyg-vaRmuxEhSrNu,v-voC!%(aR.a(a7+1Ro1>Ro5CE{A9b]{@;5x#eO{:g;urRi+KrNA!%(Ro3>Ro79;Ri_Ku@>{;&!x%gX|{KunA_+g5QRj/g3u5Rj#g>uERj%wio/xRhS&!,!#^1U}wba{8>>@=be}qC@:D5ba{7Ku+A&!}x?ba}t>>@=be}se(aA^^^Uat!b0#{pa+awUazbGa#aLb9bgaWac'a5TbS=Br!d1#`%scp_Jvl!#rT>Re0JvX&!VyN=H{Fcm#U&:pY=ReaJv2&!]h0=]nUJvG'!6Vy|=<r%JrM_=]h2@Wlud'#)U'Wf'b]{i=]h/Jvh!&~BpWg=v]RnMx+ny#'Nu;pVwjnu=]nwxJnx,T#`&Reqwjnt=]nvieu9vrRjLLuYwP(#+!th@wih5pX~Gr'g5v/Rh4KunA'!-CARnP@wwiN:Rm_9x'cvw>!|l=<saKvAA!0&3@q}>w^e1bp#&Re2Re3BDx7gH#T|f5H|eKuZ>!%(:qNAH{]Jv6!+3B2B9=b^{X<5<B92:E{ZLvhwA(a;a%!igQuyRmad+#Y}m@3Rh5d8#X'X*:AqUAHzmaxwbh<aXRnVcF}RT#Nw&cj#U(BWnug/vsRntdka)(a3+.Zb7aYYan1!bVa@Xa}[y^@b[{G=H{+hFu73Rj&Pv#5ReQcK%T#sig1v{Rj'Ku+D#'!t]~Grm~?rkKuMB!01d5#`'Vy.ta3Dtu~Hroc8#'{^45s85AwZbP&!#Rn!wghxWn#KvEA!)&2RlA2RlBx:h|#(T,=]j09Wobz>x]z/@awRoTd+#Y(az]hFhCrm4d,#Y+jTv|Q~EfMj]uNr|~FRfOdCa!Xa9_X#@<plJvf!%b`{(9;Rgwc;.!#2x7cw#T|UDb]|T5Ju={(!=@E{&Jv)&!Ab`{'awJvf!~*>>@=be{#KuY>!+&4Ezyi[ugv&RjIdea+T)#UXa&T-T&a!Rh9auRmW=]kLg5vuRn+g3u4Rn-Ow6ARn,hHus5xNk?#UX(U~)/g8v0RkD~AwkkF?Ri.OuNBwkkA?Ri/d|a2`a*^UYa.!aBTZaTa'Xa;!(!2!-a#b2[yC>6Vyq3[xr2Wi?g1rusVh%s?DtF~<5rbJs;%!DtBfswKtCj[uvuSsEu3RgVx3o:u+wN'*Zt;@3rd~Grh~?rfg8w)Lq)qE&-a%!>bI|`jWv0vV~EfCjTv|vV~Ef@j]uNpn~FRfBcK#T']gWNu7x,k7q4ai(0!hHv8<RhmkMu9vrsBuev/RhlCJvB!,g<v{wchh~@:Rhji[vrv{wchi~@:RhkdS&a5UY#Ta!RgPwwiI5BwciI~@:Rh`x'iJvj'!5]iJPu8Bwch]~@:Rhach)U#h3rp]gLh@t|Ax,hTq3ah!-(~@:Ro0Ou!5RhXj^v(pyw8unRhVd|)`,^UYas!a?/a2Z'a^Ta{Tb7Ta(a#!a,Wf&9sZ3DtAadamov=Bqt3[xig8vsRm~>waiL2b`{QJv*_Ouv2qgj<v]v2BqfdR'X*X#Y-@3qr~Gqv~?p6hHv-]glPup5Lq+q?_%*b_{qF{n9b^{rOu4ARhpKvCD!+&~Bqp:5Dbb}nwoiKl&unuTuBv]v+ueunaXRf0=Jvh!0nKufu8v1w&w7q%w&uHrz:Rgnj5w,uxDJq/(!hNw'5ReCk0s2u3w/w'5ReFd>Za&!*UaA=<wkgsRnSJv^!%Refifw3vyRgOKu_B'!,<]gkiiu:w&Rh<=C@a^<B57@2F{[<B5@aW:=3away9A5aW=<B=C@a^<B57@2F{Ie-#`(^^^bCara.b8aza6!/bZ,!adTbnTbOb+aFaS!aAT9@Wf~2Wli3Dtl2@d,#Y&RfnRfmJwJZtN~GqyJva&!VyMg<v~Rm%iXuJu3Rm9Jv[_=]ih9wlkDRkCd1#`(@Wg>2Wls3cH#T(@<Rj*=>Ri|b~'#23s9h<~El.d'#Y&Dtxi^rzvdRl#d*#U%(o|B2s`hJwSaxRmDKv4B&!1:Rmdd5#`'Vx}to~Hq{x'f1v3(!BA5ba|bJv_&!Wfug1v]ReIdO+U/Y#&G}-8wze=Rh{g1v]ReHg/uQRf/by#)ibQwERl/cH#T(@<Rj+=>Ri{cNu+vlax-!(#a0qa9<Rii2;;bU{H;x<i=&X#Rk`<4wwi=C9H~8xAI(Y#<azRi@45wXI<B9;5bb~7dL(X#Xa(+!aL6Vy{g5QqOau:5au2@ay547EzbxOcU(UX-T#Ta#:Cbb|A?wjh/b_|SOw6ARgtihr}u7Rhy<d1#T)X1@@=I|~=ay<2@@=aybb}Sj3vLv;<d,#Y(56H}A978H}@dGpvs@uAu`vcw9*!aFa+ai%(b!aXa8.a?a[ozWey=sU2@G}Nch&U#Rf_WexKu+D#'!t:~Gr`~?r^j]uNr|~FRg*j^psurwJt|RmcKv)@&!)7Rkv~Br[@wxfO:Rl3co#U'6Rezj_q#vIuavjRltwzeyh@vr5JqD0!>aY?C9:9au@9Cb]}9cl#U*5;5<H||jbuus1ucv&Rfvg1v~d/pppzqFr^a--a~!aMat1(hFv;Wiz@@=Izoj5uuv-7Rix~Cw`fk2WlVcZ#X,k)u3vWs@u2]ktg;wEx'fBq(_2Wg/jTv|vV~EfoJv]!15x'hzqG!(P~EfU~CRl_j6v(us5x4i-#T(2WmZ?C2F|d>Kq<aj1!*jTqIsBv=Wl`~Cw`fi2WlWj`v0u*~>RlR=c>Z,k#u3vWs@u2]kr<c1Z+jTqIsBv=Wla~Cw`fm2WlXdmb3!a{(arZa`bkTa%TbQTa-a9+c'!aM!/[yL=Bqug.w'RifhFvyDRj.g>vgwyk^9]k^Jv3_@WfbAARkhJw2_[x|JvB_wkoIRoKwkoJRoLd'(Y#<]gm=<9<H|yd'%_X#skDtb3awwqkgNulRkgdB#^',9:p'hJwSaxRmEBwVb8@4=H|qLu+w50&!)@3qs~?pU>Awwn;;Rn=c:Z'ARn<=<qwKvC@!/&~BqqJv6!&]eVb^z^xRge'/a%+^`#Sge}6<4Rn3=]n0Pw2>Rn8Jw0!&>Rn:>Rn6cY#a7+!a&=<wkaNw~h3z_c5Z{=wjh#=]nLKv^D!&)Vyz=bW|swYb<WetcG#T(2wxa@qVx@gD#Y&b^|V5JwG&!5bb|pg/w&RgD@x=kHs=uAvn!a%%/'+RmSRh694Ro`g-vaRmRhHv-]mlxCcS#`&ba~.5cD#Ta)P~=d,#Y(56H{>978H{Dd_#{2^Y%_+qbbb{6g3sERhsbU{?dfa.,`a(Xa<!aiX#(55RiG54RiHcI#T'WiU3RiVNvdwtfcRlKNvdd,#Y&RlHRlExQgf.1*^T'X#Sgf}6Wn4=]hfPrk>Rn7Jw0!&>Rn5>Rn9Lunw?&a2!,5<oq@@wqfdRlJj5Q~=d,#Y(~ARfcOuN]fdDKw;ay(}i!547E}j?cI#T(@5bV}iCbV}hdv(^^Tb?a40,b##Tbo!a*bR!a<b|a/!aKai!aU[yK=]o^g:v>ReGJwPZtK<7Rh+h<~El,Pv#5ReR@awwxjCg,ulRjDJv6&!]j!z?aQeeg>w=Sh<eeJw;!&axEzOg,Qosc!#*:wkeJ]eJ>x'h-u(!%Ro.w~h.zPdNZ(X,Ya![x{;9ReY;wkgxRiF:x?ap#Y&RmUg<s2Rkod]+UY0TZ'!a&A9sw<=bczLNvuw{gqzNhJwSaxRmCKuLay!#&s_Rf-55b^{uJvZa!!c%#(55Ri654wmiu5RiuawLu,vp!+}^%b_}Y9;wkgxba}o>A9:=b^}zKuh=a''!3awRk3c*'!#aHRk6c+Z&Rk5Rk4Jv)&!awRjSawd9*`#0?C2@EzMj8u<uJ5RmbjQrquJu3x,k>uq@_+=ayb^|W~ARkEOuN]k@7dhzV^X/X&a-#zRzSb`zXcJzTT#2WkVKvDBzW!%FzY9;5bbzWjQrquJu3Jw3%!b`zU=ayb^zQd:#X(T-a!6Vyywxh}=b]{Jg=u1RiAdGp~qHtzv!w(wA+a+a;<!aJaYai'anasb(=azRmV:Cbb{MLq2vb!%')RjuRjrRjtRjqx3jnqCw3!%')Rk(Rk+Rk&Rk)Lq2vb!%')Rj{RjxRjzRjwLq2vb!%')RjsRjpRjfRjex3jcqCw3!%')Rk'Rk*RjkRjl9<CbbzfOu4ARhxLq2vb!%')RjyRjvRjhRjgx=joq*uKvb!%')+-Rk.Rk%Rj~Rk-Rk#Rj}x=jdq*uKvb!%')+-Rk,Rk!Rj|RjmRjjRjidAq&qKs@uAv8Aa.'*-a@a&0!aM@a5[y73Dsy3Ds|3Dt):wxgI2sHJwJZt.~Gqxwsf0ikrzt}Rl0Jvy_[xj~HqzKv_A|D!&WfP8axRoVcf,U#k(v]v+ueunaXRf1Ju}'!g8u#Ri=jQw!sCunLprq>!,')~<5qeGzq9F{W=c##%s5au:5aU3CBE|;d4#X(D!a&6Vygx(b;#(=]ed?C2F{N<capoq2r[a&!aPa9,'Pw;5s:@@=I|,55w_h|@@=IzcP~=x'fCqB_2Wl2>aU@@=I|1OuNBc1Z+jTqIsBv=Wlc~Cw`fl2WlZ~AcTa%!Z+jTqIsBv=Wlb~Cw`fh2WlYk+uNqJsBv=WlSg,u3dca3#UXaMYa)TaB-=cM|7T#<bI}l5@B932:aV2G{BOuNBJq:|M!5Ezt=<B=C@a^<B57@2F{v>cB{/T#=ay<bI{3Jv6!a.6BKq0ah&+!5E}HP~Ef{978BaU@@=Iza<7d#.Y#978BaU@@=IzH~AJq0!(@@=IzG978BaU@@=IzFe,aU*Y&^^^bvJb,b:bFad!a,c2Ta>aL.bo6!a#CbTa'T#Re{2Wlh2@G{yg6t~Ro_NvdRfticuRQRllJv3&!x&c|zs@Jw3!%RflwpfkRlpKuL;%(!Re<@G|C2GzdhIvuBwgjAg-u0RjAKQB%!(GzZ@G|5NuuRl7d='T+Y#Vy[g<v~Rm!==G|>JvA!)@wma=]m1ifuaw&RmnLs@vT'!|/+[y,g:v>ReTJw1!#qX=x!eC{bLu+wT&)ZtZauq_~Graci&U#F|89:r_Lupvq!.)&2RlG8RfaC=x!eF{_h?rpWlmd&'!#X|&]k::xJey#`'T|+<E|&2@H|%dE#(^,g;u.RiEg6vjRiC9xCkA{O|zY#g=ucRmXKs0@!&*@G|m@awRknJuh!,3d(}gY}eJvj!%Rm):Jw3!%Rm+Rm-Ls0w(&!a(a#@b[|6cZ#X'7RkxWgAOu4ARn'dH'U#Y*Vz-Wm'CARm}d]*#a%^a*T'aK!a<9bV{PC=p*Jw4!&SgxcbB5r]idw(wBRmF7xFkt#&`(Rm/Rm8E|!JuY_9:Rl5=wrgr2:bbxd@xXfB(a*#T+!.X0X1Ta/a'T&RlDRfL>RlyARl9b[z[>RfZ:RlL:RfRwlg/ARl;9;RlxKv,A/!%7s69<74=BA5ba{-8Bde#`a<XaKYa1,a'P~=wxfB2bZ}}?C972@@=I}r8@55B9;5bb}G978B2@@=aybb}3j3vLv;<Jw3&!>Rfk=ayb^}4~Ad1#`*@@=aybb{w2@>==<bbz]dx+UY#^UaF!a9!bB'Ya1.!ajXa#%olRhD[y=3Dt#Ov5BrHKuMB%!(Rf^Wep~HrJwkiQjKr|~FRg)Ku+D#'!t5~GrF~?rDdV)UY,Z/_7RkuG{<~BrBg,rlsO:235B@bX}|d?a1!#`(6Vyn5@d##Y+jTv|vV~EfIj]uNpn~FRfH7Lq2vb1!a9-978BaU@@=Iz9978BbU}#~AJq0!(@@=Iz8978BaU@@=Iz7~AJQ|}!978BbU}!JvkaK!AdUa21-U#`a+(g/vsRn~Ou!5RPj:rmu9WhOjXuvvNr}:RhAj^v(pyw8unRn[kPr}p|u7vwv]RiSBd;pppzq@qHQa?(b.!a.a`@.|xa(hFv;Wiyj5uuv-7Riw~Cw`fg2WlU978BbU|wOuNBJqG!(P~EfD~CRlQcZ#X,k)u3vWs@u2]ksg;wEx'f@q1_2Wg.j]uNpn~FRfqJv]!15x'h{qG!(@@=IzK~CRl^j6v(us5x4i,#T(2WmY?C2F{1>Kq<aj1!*jTqIsBv=Wld~Cw`fj2Wl[j`v0u*~>RlT=c>Z,k#u3vWs@u2]kq<c1Z+jTqIsBv=Wle~Cw`fn2Wl]dn1#c(a(b^a2!b/bAT(bj!aDa7bu,a_a{c0!2T0g:v>ReD2@G{42@G{5~DpM~<5rc=Bx6i>{RT#RnI@zCx]y]z:2Jv[!zr5Awyk]9]k]dD(Y+X#6Vz.g=wKtgwhaCwgmTWj2Lu,w%_+/[y-B;b^xeg3u3Rj-2@bX{*KrJ<!+'@Wg(g?QRlC@Jv`!%b[zIwsfII}8JQ_@w|kW|=Jv(%!AqcOuNBJvEzh!bYzjLs@wP#(0!oy@>RkdJwMZtc3Dtd@BcG#T'9bWxg2@2Fznd*#Y+;2x'c}w<zizixNgwa#Z'U+!/!a'!a+w~g~z6wcn{Rn}wcnzRn|5Rh%=]nJg5vuRmvNvdRlvcprJu}w*az*a#!%.a.'Bot9qT]kj@Wg'ay2Gzv@Jv`!%b[zEwsfHI}1;ck#Ux`<Cbbx_Lu+w!a&0*!wko*wwo,So,}6Juqxf!E}PigQuyRm`d3(`#8>Rn%:A5B;bZ~%KvhCa!a2!x>k7#Uxb@b{#xaRk7Jw0!)>wwhlShl}6>wwhmShm}6CJvB!.x'hhvj{!!5Bwkhhbaz}x'hivjz~!5Bwkhibaz|xEhTrNu,v-vpD!a%&/)a3a.,%Ro2t[CE{)@3re9b]{%wjo09:rgc:Z&Ro6=<riifuaw&RmoKrNA!%(Ro4>Ro89;Ri`dSaL'UYzxZb)7Rka3xRhT&!,!#^1U}vbaz{>>@=be}yC@:D5bazzKu+A&!}{?ba}y>>@=be}wxBh[t`u~vJvr!%a!a()a,a0a4RoC=]o;Ju(!%RoGRhdwjh`=]oAg>w#Ro?g5vuRo=NvdRl|Ku]C.!&;RoEJvB!%RoORoMBx'h[v+_?w~h`}~5?w~hd~!xKh]oiptu-utv.vp!#%&a30a@a'a+(a/aOp(o~p!RoDJu(!%RoHRhewjha=]oBNvdRl}g>w#Ro@g5vuRo>c[#X']o<CauRoRAd-#Y':RkpauRoQKu]C.!&;RoFJvB!%RoNRoPBx'h]v+_?w~ha}t5?w~he}ue!/UbhYacXaW^Tc&a;b:a-c/#b&aja1(!cL+!bKbt!bmcRc9aIc?8[yW3Dtt94Rg`Jv}!&SiRMzBhEebShEMNuPRe>x7gL#TzuwjirRipc<Z&>on;>z=h-MSh.Mwqczx'a7vj&!>Re4@=ResJt__NuPRi*NuPRi)j]uNr|~FRfzKrJ>_+@Wfy@Wf]2WocKrJ<!+'@Wg%g/QRl@@Jv`!&awRl<wsfFIzgLu(w*!.*&ShBMwvhIRhI9;RhNx1hK'!#Sn]Mx1hK~0!#:2<H~7cNu+w7D*'1ZtW>Rn1~?rOc:Z&Rn2=<rQ<7wjh&=BSnLMc]#X(6Vz)w[b=a!U#9wzgMc3#&(RgMRitRis<x,gKt`ax!&+SioM=BSilMc3#&(RgKRinRimKurB,!&SiQMzBhDebShDM6BJQ!(P~Efx978B2@@=I}WLrJw!!,a*&@G}O@9wkibRid@@x'fKwC!&SlDMSfLMjUv~Q~EfKKv3@a+!(hFv-]mpx/hYZ(C5RiWz<o/MwkhY?So/M@x,gbvfB*&!SgEM:SoeeehFu3:Rgbda(,^TZa)X/7Sg[eb:2RgI~BrMC@wgkc:wwkcRerx3h(uUvK!&*,SnOM4Sh*MArRg;wHRh(x=h;rJvPwI!a4',a'0@Wg&=BSh/Mg>w=Rh=g3w*wwgGRgGcW(X#;Sg}M2Gzk@Jv`!&awRl=wsfGIz`dKZ*T'Y-:RhR7RhQg5u-p`j6v(us5d,#Y+~Awkia?RicOuNBwkibba}Ld6p~tyu_vbAa'a+!a/'a3aEa8a!>Sh,ebJv{!&Sh@ebSaReb9;SgwebNuPRi(NvdRl)NuPRi'hHu^<Rm^Jvv_@Wl(g;u1Si/ebKu'B&!*Sh?eb@Wl'z@aPeb95Si.ebcpputyvjB)!,&a+0a%ShAMWeK@G}C@WfJ9;RhMwvhH9w{ia}ix,hJvRA1(!zAn[MRhHx1hJ~*!#hFv(BSn[MBJQ!(@@=I~'978B2@@=I}2db.Ua<'X}+T#a0XaG2G}E;wkg|wuh!Rh!x,hZu,@)!&So0MVy)C5RiXACJvB!&5RiY5RiZg8w)cG}*T#2@bU}=KsA>(!a.3wkhZba~(x,h^u(A!&(SoCMRhb5Bz=h[eb?w~hb~6x,h_u(A!&(SoDMRhc5Bz=h]eb?w~hc~6e)aA1T#T,^^^c-bMb&blcPaP(a/!0!bA=b5c@a(!bfbrc#2afwmhARnjwchORnp2Wlf3DtsNvdRl-2@wpa<]m0bx(#:awRk2@Jw3!%RfhwpfgRlnKQB%!(G{V@G|'NuuRl6d='T+Y#VyUg<v~Rl~==G|<Jv+'!aYShC}6@B<5?ba~8@Jw3'!g2QRljhLrpWlOd+#Y'g.w'rIg>w*wgj@g-u0Rj@Lu+wT&)ZtUauq]~GrGci&U#F|39:rELrNvj!.%*RhCwunfw~nf~:9;Ri]>wtnhg;wHRnhx3hDs@v~!/+'@Wfr@9RkSNu&Rlo=@<5GzoKs0@_+@Wl+@awRkmJuh!-3d(}pY#qWJvj!%Rm(:Jw3!%Rm,Rm*de&!1U-U#`)Re;@G|.@9Ri82@wjfvRlq=@<5GzpLvOvr!).&2RlF8Rf`C=x!eE{.Jw3_g2QRlkhLrpWlPde(!#U{s,UXa*Ta'[y'g:v>ReS;x0PZ&RnlRnn~HrKJw1}f!=x!eB|2w]aP(#Xa&a*Ta.Ua2a7=]iOd'#Y&Ro&WnWg;u.RiDg6vjRiBNvdRlzhNvj]nYJuW_2Wm3x)kFze{9d])!a.!,Y01!#&aC!a3RndC=ox~BrC@2b^{pg,rlse7x'ksuq!%Rm.E{xidw(wBRmGx9o+)X#wwo-So-}69:Rl4@xSf@a#XZ'X)X,Ta(/ARl8b[xc>RfY:RlI:RfQwlg.ARl:9;Rlwdn'#^XafaQa1X1TaHTa)@b[{zcZ#X'7RkwWg@Ou4ARn&x)kG#{,g7u/RkGdH'U#Y*Vz'Wm&CARm|bx#(A]gUbUzJj9Q~=d,#Y(56H}l978H{U7d,0#U*2>ABb_xZ978BbU{e~AJQ{g!978BbU{hxMh?ad{oUYZ.x1h?{l!#:2<H{mx3n[t{vl!,&a%3Ro(z=iS}6ARnr=Bwsn^wvn`Rnbd`*T}B0!#^X'BG{c9b]{a>>@=be}F?JvS!&BG{d7BG}(Bde#`a1X,Ya@!a'P~=wxf@2bZ}I56B2@@=aybb}08@55B9;5bb}<j3vLv;<Jw3&!>Rfg=ayb^}&OuNBKuLA!)a!P~=x#fD{f2@>==<bbzl?C972@@=Ix^d6rSu,v7w*C(0a)a6#B+a%!sQ[y?3Dt%3[xn~<5rLOu!5p@Ku+D#'!t7~GrP~?rNKvlaya7'!h+v-5qMg=t|cd,U#5AAaa5Abb{S@52B5@a[@52B5Gx[iXueu;d<#`a(!/549C;ag>23ExY5@Dah89b^~689Jv)!~2b[~1Lv'w(%*!a#bX|aPrmawRe]keu7uhv-q6rxu,q`xTo]/a5aU!bNaDXbi!b-!ao!b<bwA!#5@B932:aV2G|:d-)Y#hJrL>RhG<7@C5<H|_=Cau:5aj5@B932:bJ|ng>vIbs)#?C2F|9jPv0w.vISh-MKvUaz(.!9ABbb|[5;5<H|Eg>unwfh;9:4E|YjQsBt|vjx'hYq3!(?C2F|J:2<BaY?C2F|GOu!5x,g|p{ah!-(?C2F|c9:4E|OjXuvvNr}:Rh&i[w*t|cd+U#jJvsu)vsSn~Mkfrmu9p}u7vwv]So!McW#Xa!ax5@A5aY:5;5<H|>kJv~vYrquJu3x4ib#T)2@SmZM?C2F|Bj:rmu9@xPhI(a*a#U#`a3-5Abb|L~@:RhK9:4E|0@52B5G|#C::aY?C2F|-:2<BaY?C2F|.5Jvk!a)javYrquJu3x4ia#T)2@SmYM?C2F|HAxPhH(!a#U#`a*-5Abb|4~@:RhJ9:4E|R@52B5G|F:2<BaY?C2F|Sc^#Xa2j=Qq5CJvB!-g<v{z;hhM?C2F|Zi[vrv{z;hiM?C2F|XKsA>!a)-g<v{z;h[eb?C2F|]i[vrv{z;h]eb?C2F|^iZu.vix,hZq3ah!.(?C2F|QOu!5ShXM:2<BaY?C2F|P", 13494, 2713, 49, 25, 61);

// node_modules/entities/dist/internal/bin-trie-flags.js
var BinTrieFlags;
(function(BinTrieFlags2) {
  BinTrieFlags2[BinTrieFlags2["VALUE_LENGTH"] = 49152] = "VALUE_LENGTH";
  BinTrieFlags2[BinTrieFlags2["FLAG13"] = 8192] = "FLAG13";
  BinTrieFlags2[BinTrieFlags2["BRANCH_LENGTH"] = 8064] = "BRANCH_LENGTH";
  BinTrieFlags2[BinTrieFlags2["JUMP_TABLE"] = 127] = "JUMP_TABLE";
  BinTrieFlags2[BinTrieFlags2["VALUE_MASK"] = 8191] = "VALUE_MASK";
})(BinTrieFlags || (BinTrieFlags = {}));

// node_modules/entities/dist/decode.js
var CharCodes;
(function(CharCodes2) {
  CharCodes2[CharCodes2["AMP"] = 38] = "AMP";
  CharCodes2[CharCodes2["NUM"] = 35] = "NUM";
  CharCodes2[CharCodes2["SEMI"] = 59] = "SEMI";
  CharCodes2[CharCodes2["EQUALS"] = 61] = "EQUALS";
  CharCodes2[CharCodes2["ZERO"] = 48] = "ZERO";
  CharCodes2[CharCodes2["NINE"] = 57] = "NINE";
  CharCodes2[CharCodes2["LOWER_A"] = 97] = "LOWER_A";
  CharCodes2[CharCodes2["LOWER_X"] = 120] = "LOWER_X";
})(CharCodes || (CharCodes = {}));
var TO_LOWER_BIT = 32;
var CONSUMED_SHIFT = 21;
var CODE_POINT_MASK = 2097151;
var CONSUMED_OVERFLOW = 2047;
var longNumericConsumed = 0;
function unpackConsumed(packed) {
  const consumed = packed >>> CONSUMED_SHIFT;
  return consumed === CONSUMED_OVERFLOW ? longNumericConsumed : consumed;
}
__name(unpackConsumed, "unpackConsumed");
function isNumber(code) {
  return code - CharCodes.ZERO >>> 0 <= 9;
}
__name(isNumber, "isNumber");
function isHexadecimalCharacter(code) {
  return (code | TO_LOWER_BIT) - CharCodes.LOWER_A >>> 0 <= 5;
}
__name(isHexadecimalCharacter, "isHexadecimalCharacter");
function isAlpha(code) {
  return (code | TO_LOWER_BIT) - CharCodes.LOWER_A >>> 0 <= 25;
}
__name(isAlpha, "isAlpha");
function isEntityInAttributeInvalidEnd(code) {
  return code === CharCodes.EQUALS || isAlpha(code) || isNumber(code);
}
__name(isEntityInAttributeInvalidEnd, "isEntityInAttributeInvalidEnd");
var EntityDecoderState;
(function(EntityDecoderState2) {
  EntityDecoderState2[EntityDecoderState2["EntityStart"] = 0] = "EntityStart";
  EntityDecoderState2[EntityDecoderState2["NumericStart"] = 1] = "NumericStart";
  EntityDecoderState2[EntityDecoderState2["NumericDecimal"] = 2] = "NumericDecimal";
  EntityDecoderState2[EntityDecoderState2["NumericHex"] = 3] = "NumericHex";
  EntityDecoderState2[EntityDecoderState2["NamedEntity"] = 4] = "NamedEntity";
})(EntityDecoderState || (EntityDecoderState = {}));
var DecodingMode;
(function(DecodingMode2) {
  DecodingMode2[DecodingMode2["Legacy"] = 0] = "Legacy";
  DecodingMode2[DecodingMode2["Strict"] = 1] = "Strict";
  DecodingMode2[DecodingMode2["Attribute"] = 2] = "Attribute";
})(DecodingMode || (DecodingMode = {}));
function determineBranch(decodeTree, current, nodeIndex, char) {
  const branchCount = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
  const jumpOffset = current & BinTrieFlags.JUMP_TABLE;
  if (jumpOffset) {
    if (branchCount === 0) {
      return char === jumpOffset ? nodeIndex : -1;
    }
    const slot = char - jumpOffset;
    if (slot >>> 0 >= branchCount)
      return -1;
    const stored = decodeTree[nodeIndex + slot];
    return stored === 0 ? -1 : nodeIndex + branchCount + stored - 1 & 65535;
  }
  if (branchCount === 0)
    return -1;
  const packedKeySlots = branchCount + 1 >> 1;
  const branchEnd = nodeIndex + packedKeySlots + branchCount;
  for (let index = 0; index < branchCount; index++) {
    const packed = decodeTree[nodeIndex + (index >> 1)];
    const key = packed >> ((index & 1) << 3) & 255;
    if (key === char) {
      const pointerIndex = nodeIndex + packedKeySlots + index;
      return branchEnd + decodeTree[pointerIndex] & 65535;
    }
    if (key > char)
      return -1;
  }
  return -1;
}
__name(determineBranch, "determineBranch");
function readTrieValue(decodeTree, nodeIndex, valueLength) {
  if (valueLength === 1) {
    return String.fromCharCode(decodeTree[nodeIndex] & BinTrieFlags.VALUE_MASK);
  }
  if (valueLength === 2) {
    return String.fromCharCode(decodeTree[nodeIndex + 1]);
  }
  return String.fromCharCode(decodeTree[nodeIndex + 1], decodeTree[nodeIndex + 2]);
}
__name(readTrieValue, "readTrieValue");
function parseNumericEntity(input, numberStart, inputLength) {
  let offset = numberStart + 1;
  let cp = 0;
  let digitStart = offset;
  if (offset < inputLength && (input.charCodeAt(offset) | TO_LOWER_BIT) === CharCodes.LOWER_X) {
    offset += 1;
    digitStart = offset;
    while (offset < inputLength) {
      const char = input.charCodeAt(offset);
      if (isNumber(char)) {
        cp = cp * 16 + (char - CharCodes.ZERO);
      } else if (isHexadecimalCharacter(char)) {
        cp = cp * 16 + ((char | TO_LOWER_BIT) - CharCodes.LOWER_A + 10);
      } else {
        break;
      }
      offset += 1;
    }
  } else {
    while (offset < inputLength) {
      const digit = input.charCodeAt(offset) - CharCodes.ZERO;
      if (digit >>> 0 > 9)
        break;
      cp = cp * 10 + digit;
      offset += 1;
    }
  }
  if (offset === digitStart)
    return 0;
  if (offset < inputLength && input.charCodeAt(offset) === CharCodes.SEMI) {
    offset += 1;
  }
  if (cp > 1114111)
    cp = 1114112;
  let consumed = offset - numberStart;
  if (consumed >= CONSUMED_OVERFLOW) {
    longNumericConsumed = consumed;
    consumed = CONSUMED_OVERFLOW;
  }
  return consumed << CONSUMED_SHIFT | cp;
}
__name(parseNumericEntity, "parseNumericEntity");
function decodeWithTrie(input, isStrict, isAttribute) {
  const decodeTree = htmlDecodeTree;
  let offset = input.indexOf("&");
  if (offset < 0)
    return input;
  const inputLength = input.length;
  let chunkStart = 0;
  let result = "";
  const root = decodeTree[0];
  const rootJumpOffset = root & BinTrieFlags.JUMP_TABLE;
  const rootBranchCount = (root & BinTrieFlags.BRANCH_LENGTH) >> 7;
  do {
    const entityStart = offset + 1;
    const firstChar = input.charCodeAt(entityStart);
    let consumed;
    let value;
    if (firstChar === CharCodes.NUM) {
      const packed = parseNumericEntity(input, entityStart, inputLength);
      consumed = unpackConsumed(packed);
      if (isStrict && consumed > 0 && input.charCodeAt(entityStart + consumed - 1) !== CharCodes.SEMI) {
        consumed = 0;
      }
      value = consumed === 0 ? "" : codePointToString(packed & CODE_POINT_MASK);
    } else if (isAlpha(firstChar)) {
      consumed = 0;
      value = "";
      const rootSlotIndex = firstChar - rootJumpOffset;
      let nodeIndex;
      if (rootSlotIndex >>> 0 < rootBranchCount) {
        const stored = decodeTree[1 + rootSlotIndex];
        nodeIndex = stored === 0 ? -1 : rootBranchCount + stored & 65535;
      } else {
        nodeIndex = -1;
      }
      let bestNodeIndex = 0;
      let bestValueLength = 0;
      let current = nodeIndex < 0 ? 0 : decodeTree[nodeIndex];
      let index = entityStart + 1;
      trie: while (index < inputLength) {
        while (
          // Value-less, non-run node with a nonzero jump offset.
          (current & (BinTrieFlags.VALUE_LENGTH | BinTrieFlags.FLAG13)) === 0 && (current & BinTrieFlags.JUMP_TABLE) !== 0
        ) {
          const jumpOffset = current & BinTrieFlags.JUMP_TABLE;
          const branchCount = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
          if (branchCount === 0) {
            if (input.charCodeAt(index) !== jumpOffset)
              break trie;
            nodeIndex += 1;
          } else {
            const slot = input.charCodeAt(index) - jumpOffset;
            if (slot >>> 0 >= branchCount)
              break trie;
            const stored = decodeTree[nodeIndex + 1 + slot];
            if (stored === 0)
              break trie;
            nodeIndex = nodeIndex + branchCount + stored & 65535;
          }
          current = decodeTree[nodeIndex];
          index += 1;
          if (index >= inputLength)
            break trie;
        }
        if ((current & (BinTrieFlags.VALUE_LENGTH | BinTrieFlags.FLAG13)) === BinTrieFlags.FLAG13) {
          const runLength = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
          if (input.charCodeAt(index) !== (current & BinTrieFlags.JUMP_TABLE)) {
            break;
          }
          index += 1;
          const remaining = runLength - 1;
          let wordIndex = nodeIndex + 1;
          let charIndexInPacked = 0;
          for (; charIndexInPacked + 1 < remaining; charIndexInPacked += 2) {
            const packed = decodeTree[wordIndex];
            if (input.charCodeAt(index) !== (packed & 255))
              break trie;
            index += 1;
            if (input.charCodeAt(index) !== (packed >> 8 & 255))
              break trie;
            index += 1;
            wordIndex += 1;
          }
          if (charIndexInPacked < remaining) {
            if (input.charCodeAt(index) !== (decodeTree[wordIndex] & 255))
              break;
            index += 1;
          }
          nodeIndex += 1 + (runLength >> 1);
          current = decodeTree[nodeIndex];
          continue;
        }
        const valueLength = current >>> 14;
        const char = input.charCodeAt(index);
        if (valueLength !== 0) {
          if (char === CharCodes.SEMI) {
            consumed = index - entityStart + 1;
            value = valueLength === 1 ? String.fromCharCode(current & BinTrieFlags.VALUE_MASK) : readTrieValue(decodeTree, nodeIndex, valueLength);
            break;
          }
          if (!isStrict && (current & BinTrieFlags.FLAG13) === 0) {
            consumed = index - entityStart;
            bestNodeIndex = nodeIndex;
            bestValueLength = valueLength;
          }
          if (valueLength === 1)
            break;
        }
        const next = determineBranch(decodeTree, current, nodeIndex + (valueLength || 1), char);
        if (next < 0)
          break;
        nodeIndex = next;
        current = decodeTree[nodeIndex];
        index += 1;
      }
      if (value === "") {
        const finalVL = current >>> 14;
        if (finalVL !== 0 && !isStrict && (current & BinTrieFlags.FLAG13) === 0) {
          consumed = index - entityStart;
          bestNodeIndex = nodeIndex;
          bestValueLength = finalVL;
        }
        if (consumed > 0) {
          value = readTrieValue(decodeTree, bestNodeIndex, bestValueLength);
        }
      }
    } else {
      consumed = 0;
      value = "";
    }
    if (consumed === 0 || isAttribute && firstChar !== CharCodes.NUM && input.charCodeAt(entityStart + consumed - 1) !== CharCodes.SEMI && entityStart + consumed < inputLength && isEntityInAttributeInvalidEnd(input.charCodeAt(entityStart + consumed))) {
      offset = entityStart;
    } else {
      if (chunkStart < offset) {
        result += input.slice(chunkStart, offset);
      }
      result += value;
      offset = chunkStart = entityStart + consumed;
    }
    if (input.charCodeAt(offset) !== CharCodes.AMP) {
      offset = input.indexOf("&", offset);
    }
  } while (offset >= 0);
  return result + input.slice(chunkStart);
}
__name(decodeWithTrie, "decodeWithTrie");
function decodeHTMLAttribute(htmlAttribute) {
  return decodeWithTrie(htmlAttribute, false, true);
}
__name(decodeHTMLAttribute, "decodeHTMLAttribute");

// node_modules/entities/dist/index.js
var EntityLevel;
(function(EntityLevel2) {
  EntityLevel2[EntityLevel2["XML"] = 0] = "XML";
  EntityLevel2[EntityLevel2["HTML"] = 1] = "HTML";
})(EntityLevel || (EntityLevel = {}));
var EncodingMode;
(function(EncodingMode2) {
  EncodingMode2[EncodingMode2["UTF8"] = 0] = "UTF8";
  EncodingMode2[EncodingMode2["ASCII"] = 1] = "ASCII";
  EncodingMode2[EncodingMode2["Extensive"] = 2] = "Extensive";
  EncodingMode2[EncodingMode2["Attribute"] = 3] = "Attribute";
  EncodingMode2[EncodingMode2["Text"] = 4] = "Text";
})(EncodingMode || (EncodingMode = {}));

// src/game-proxy.ts
function gameUrl(value, publicOrigin, upstreamOrigin) {
  if (!/^(?:https?:)?\/\//i.test(value)) return value;
  try {
    const source = new URL(upstreamOrigin);
    const target = new URL(value, publicOrigin);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) return value;
    const ip = target.hostname.split(".").map(Number);
    const privateIP = ip.length === 4 && ip.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) && (ip[0] === 10 || ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31 || ip[0] === 192 && ip[1] === 168 || ip[0] === 127);
    const localFeed = privateIP && target.port === source.port && target.pathname.startsWith("/feed/");
    const publicHost = target.hostname === new URL(publicOrigin).hostname;
    if (target.origin !== source.origin && !localFeed && !publicHost) return value;
    return publicOrigin + target.pathname + target.search + target.hash;
  } catch {
    return value;
  }
}
__name(gameUrl, "gameUrl");
function rewriteGameHtml(response, publicOrigin, upstreamOrigin) {
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.delete("ETag");
  return new HTMLRewriter().on('[href], [src], [action], [poster], input[type="url"][value]', {
    element(element) {
      for (const name of ["href", "src", "action", "poster", "value"]) {
        const before = element.getAttribute(name);
        if (!before) continue;
        const decoded = decodeHTMLAttribute(before);
        const after = gameUrl(decoded, publicOrigin, upstreamOrigin);
        if (after === decoded) continue;
        element.setAttribute(name, after);
        if (element.tagName === "a" && name === "href" && new URL(after).pathname.startsWith("/feed/")) {
          element.setInnerContent(after);
        }
      }
    }
  }).transform(new Response(response.body, { status: response.status, headers }));
}
__name(rewriteGameHtml, "rewriteGameHtml");

// src/index.ts
var now = /* @__PURE__ */ __name(() => Math.floor(Date.now() / 1e3), "now");
var reply = /* @__PURE__ */ __name((data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } }), "reply");
var redirect = /* @__PURE__ */ __name((url, cookies) => new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", ...cookies ? { "Set-Cookie": cookies } : {} } }), "redirect");
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
  static {
    __name(this, "HttpError");
  }
};
function need(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}
__name(need, "need");
async function session(env, hash) {
  return env.DB.prepare("SELECT s.*,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?").bind(hash, now()).first();
}
__name(session, "session");
async function audit(env, actor, action, target) {
  await env.DB.prepare("INSERT INTO audit(ts,actor,action,target) VALUES(?,?,?,?)").bind(now(), actor, action, target).run();
}
__name(audit, "audit");
async function auth(request, env, role = "viewer") {
  const user = await session(env, await digest(cookieValue(request, "__Host-farmservers")));
  need(user, 401, "Sign in with Discord");
  need(allowed(user.role, role), 403, "Your account needs approval for this operation");
  if (!["GET", "HEAD"].includes(request.method)) {
    need(request.headers.get("Origin") === env.APP_ORIGIN && request.headers.get("X-CSRF-Token") === user.csrf, 403, "Invalid request origin or CSRF token");
  }
  return user;
}
__name(auth, "auth");
function gateway(env, id) {
  let entry;
  try {
    entry = JSON.parse(env.NODE_GATEWAYS || "{}")[id];
  } catch {
  }
  need(entry && /^https:\/\/[^/]+$/.test(entry.origin) && /^[a-f0-9]{64}$/.test(entry.token) && entry.accessClientId && entry.accessClientSecret, 503, "Node gateway is not configured");
  const url = new URL(entry.origin);
  need(!url.username && !url.password && !url.port && url.hostname.endsWith(".sargentweb.com"), 503, "Invalid gateway origin");
  return entry;
}
__name(gateway, "gateway");
function gatewayHeaders(g, user) {
  return new Headers({ "X-Central-Token": g.token, "X-Central-User": user.user_id, "X-Central-Role": user.role, "CF-Access-Client-Id": g.accessClientId, "CF-Access-Client-Secret": g.accessClientSecret });
}
__name(gatewayHeaders, "gatewayHeaders");
async function oauth(request, env, url) {
  need(env.DISCORD_CLIENT_SECRET, 503, "Discord login is awaiting configuration");
  if (url.pathname === "/auth/login") {
    need(request.method === "GET", 405, "Method not allowed");
    const state2 = randomToken();
    await env.DB.prepare("INSERT INTO oauth_states(hash,expires) VALUES(?,?)").bind(await digest(state2), now() + 300).run();
    const target = new URL("https://discord.com/oauth2/authorize");
    target.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: env.APP_ORIGIN + "/auth/callback", response_type: "code", scope: "identify", state: state2 }).toString();
    return redirect(target.href, cookie("__Host-oauth", state2, 300));
  }
  need(url.pathname === "/auth/callback" && request.method === "GET", 404, "Not found");
  const state = url.searchParams.get("state") || "";
  need(/^[a-f0-9]{64}$/.test(state) && state === cookieValue(request, "__Host-oauth"), 400, "Invalid login state");
  const valid = await env.DB.prepare("DELETE FROM oauth_states WHERE hash=? AND expires>? RETURNING hash").bind(await digest(state), now()).first();
  need(valid && url.searchParams.get("code"), 400, "Login expired; sign in again");
  const tokenResult = await fetch("https://discord.com/api/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code: url.searchParams.get("code"), redirect_uri: env.APP_ORIGIN + "/auth/callback" }), signal: AbortSignal.timeout(15e3) });
  need(tokenResult.ok, 502, "Discord login exchange failed");
  const token = await tokenResult.json();
  const profileResult = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15e3) });
  need(profileResult.ok, 502, "Unable to read Discord profile");
  const profile = await profileResult.json();
  need(/^\d{17,20}$/.test(profile.id), 502, "Invalid Discord identity");
  const role = profile.id === env.BOOTSTRAP_ADMIN_ID ? "admin" : "pending";
  await env.DB.prepare("INSERT INTO users(id,name,role,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=CASE WHEN excluded.role='admin' THEN 'admin' ELSE users.role END").bind(profile.id, profile.username.slice(0, 100), role, now()).run();
  const sid = randomToken();
  await env.DB.prepare("INSERT INTO sessions(hash,user_id,csrf,expires) VALUES(?,?,?,?)").bind(await digest(sid), profile.id, randomToken(), now() + 28800).run();
  const response = redirect(env.APP_ORIGIN + "/", cookie("__Host-farmservers", sid, 28800));
  response.headers.append("Set-Cookie", cookie("__Host-oauth", "", 0));
  await audit(env, profile.id, "login", "discord");
  return response;
}
__name(oauth, "oauth");
async function heartbeat(request, env, id) {
  need(request.method === "POST" && validId(id), 405, "Invalid heartbeat");
  const bearer = request.headers.get("Authorization") || "";
  need(/^Bearer [a-f0-9]{64}$/.test(bearer), 401, "Unauthorized node");
  const node = await env.DB.prepare("SELECT id FROM nodes WHERE id=? AND token_hash=? AND enabled=1").bind(id, await digest(bearer.slice(7))).first();
  need(node, 401, "Unauthorized node");
  const body = await readJson(request);
  need(body.version === 1 && Array.isArray(body.samples) && body.samples.length <= 101 && Array.isArray(body.servers) && body.servers.length <= 100, 422, "Invalid heartbeat schema");
  const samples = body.samples.map((item) => {
    need(item && typeof item === "object", 422, "Invalid sample");
    const s = item;
    need(validScope(s.scope) && typeof s.timestamp === "number" && Number.isInteger(s.timestamp) && s.timestamp <= now() + 60 && s.timestamp >= now() - 3600, 422, "Invalid sample scope or timestamp");
    return { scope: s.scope, timestamp: s.timestamp, data: safeMetrics(s.data) };
  });
  const servers = body.servers.map((item) => {
    need(item && typeof item === "object", 422, "Invalid server");
    const s = item;
    need(validScope(s.instance_id) && typeof s.server_name === "string", 422, "Invalid server identity");
    return { instance_id: s.instance_id, server_name: s.server_name.slice(0, 150), status: typeof s.status === "string" ? s.status.slice(0, 40) : "unknown" };
  });
  await env.DB.batch([
    env.DB.prepare("UPDATE nodes SET last_seen=?,snapshot=? WHERE id=?").bind(now(), JSON.stringify({ servers, samples }), id),
    ...samples.map((s) => env.DB.prepare("INSERT OR IGNORE INTO samples(node_id,scope,ts,data) VALUES(?,?,?,?)").bind(id, s.scope, s.timestamp, JSON.stringify(s.data)))
  ]);
  return reply({ ok: true, interval_seconds: 30 });
}
__name(heartbeat, "heartbeat");
async function launch(request, env, url) {
  const user = await auth(request, env, "operator");
  const node = url.searchParams.get("node") || "", kind = url.searchParams.get("kind") || "panel", instance = url.searchParams.get("instance") || "";
  need(request.method === "POST" && validId(node) && ["panel", "vnc", "web"].includes(kind) && (kind === "panel" ? instance === "" : validScope(instance)), 422, "Invalid viewer");
  need(await env.DB.prepare("SELECT id FROM nodes WHERE id=? AND enabled=1").bind(node).first(), 404, "Node unavailable");
  gateway(env, node);
  const scope = (await digest(node + "/" + kind + "/" + instance)).slice(0, 24), host = "view-" + scope + "." + new URL(env.APP_ORIGIN).hostname;
  const ticket = randomToken();
  await env.DB.prepare("INSERT INTO tickets(hash,session_hash,node_id,host,kind,instance,expires) VALUES(?,?,?,?,?,?,?)").bind(await digest(ticket), user.hash, node, host, kind, instance, now() + 60).run();
  await audit(env, user.user_id, "viewer." + kind, node + "/" + instance);
  return reply({ url: "https://" + host + "/_connect?ticket=" + ticket });
}
__name(launch, "launch");
async function viewer(request, env, url) {
  if (url.pathname === "/_connect") {
    need(request.method === "GET", 405, "Method not allowed");
    const ticket = url.searchParams.get("ticket") || "";
    need(/^[a-f0-9]{64}$/.test(ticket), 400, "Invalid viewer ticket");
    const view2 = await env.DB.prepare("DELETE FROM tickets WHERE hash=? AND host=? AND expires>? RETURNING *").bind(await digest(ticket), url.hostname, now()).first();
    need(view2, 401, "Viewer link expired; open a fresh link from the dashboard");
    const user2 = await session(env, view2.session_hash);
    need(user2 && allowed(user2.role, "operator"), 403, "Viewer access revoked");
    const sid = randomToken();
    await env.DB.prepare("INSERT INTO views(hash,session_hash,node_id,host,kind,instance,expires) VALUES(?,?,?,?,?,?,?)").bind(await digest(sid), view2.session_hash, view2.node_id, view2.host, view2.kind, view2.instance, Math.min(now() + 900, user2.expires)).run();
    return redirect(view2.kind === "vnc" ? "/vnc.html?autoconnect=1&resize=remote&encrypt=1&path=websockify" : "/", cookie("__Host-view", sid, 900));
  }
  const view = await env.DB.prepare("SELECT v.* FROM views v JOIN nodes n ON n.id=v.node_id WHERE v.hash=? AND v.host=? AND v.expires>? AND n.enabled=1").bind(await digest(cookieValue(request, "__Host-view")), url.hostname, now()).first();
  need(view, 401, "Viewer session expired; open it again from the dashboard");
  const user = await session(env, view.session_hash);
  need(user && allowed(user.role, "operator"), 403, "Viewer access revoked");
  if (view.kind === "panel" && request.method === "GET" && ["console", "web_admin"].includes(url.searchParams.get("route") || "")) {
    const instance = url.searchParams.get("instance_id") || "";
    need(validScope(instance), 422, "Invalid instance");
    return redirect(env.APP_ORIGIN + "/?" + new URLSearchParams({ launch: view.node_id, kind: url.searchParams.get("route") === "console" ? "vnc" : "web", instance }));
  }
  const websocket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
  if (websocket || !["GET", "HEAD"].includes(request.method)) need(request.headers.get("Origin") === url.origin, 403, "Invalid viewer origin");
  const g = gateway(env, view.node_id), headers = gatewayHeaders(g, user);
  headers.set("X-Forwarded-Host", url.hostname);
  headers.set("X-Forwarded-Proto", "https");
  headers.set("X-Forwarded-Port", "443");
  if (view.kind === "web") headers.set("Accept-Encoding", "identity");
  for (const name of ["Content-Type", "Accept", "Range", "If-Range", "Upgrade", "Sec-WebSocket-Protocol", "Sec-WebSocket-Version", "Sec-WebSocket-Key"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookies = (request.headers.get("Cookie") || "").split(";").filter((c) => !c.trim().startsWith("__Host-")).join(";");
  if (cookies) headers.set("Cookie", cookies);
  const path = view.kind === "panel" ? url.pathname : "/central/view/" + view.instance + "/" + view.kind + url.pathname;
  const upstream = await fetch(g.origin + path + url.search, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? void 0 : request.body, redirect: "manual" });
  if (upstream.status === 101 && upstream.webSocket) {
    const pair = new WebSocketPair(), client = pair[0], relay = pair[1], backend = upstream.webSocket;
    relay.accept();
    backend.accept();
    let checked = now(), alive = true, checking;
    const close = /* @__PURE__ */ __name(() => {
      if (!alive) return;
      alive = false;
      try {
        relay.close(1e3, "Session ended");
      } catch {
      }
      try {
        backend.close(1e3, "Session ended");
      } catch {
      }
    }, "close");
    const authorized = /* @__PURE__ */ __name(async () => {
      if (!alive || now() >= view.expires) return false;
      if (now() - checked < 15) return true;
      checking ??= (async () => {
        const s = await session(env, view.session_hash);
        const node = await env.DB.prepare("SELECT id FROM nodes WHERE id=? AND enabled=1").bind(view.node_id).first();
        checked = now();
        return !!s && allowed(s.role, "operator") && !!node;
      })();
      try {
        return await checking;
      } finally {
        checking = void 0;
      }
    }, "authorized");
    for (const [from, to] of [[relay, backend], [backend, relay]]) {
      let chain = Promise.resolve(), queued = 0;
      from.addEventListener("message", (event) => {
        const size = typeof event.data === "string" ? new TextEncoder().encode(event.data).length : event.data.byteLength;
        queued += size;
        if (queued > 16 * 1024 * 1024) {
          close();
          return;
        }
        chain = chain.then(async () => {
          try {
            if (await authorized()) to.send(event.data);
            else close();
          } catch {
            close();
          } finally {
            queued -= size;
          }
        });
      });
      from.addEventListener("close", close);
      from.addEventListener("error", close);
    }
    return new Response(null, { status: 101, webSocket: client });
  }
  const out = new Headers();
  for (const name of ["Content-Type", "Content-Length", "Content-Encoding", "Content-Disposition", "Accept-Ranges", "Content-Range"]) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  for (const value of upstream.headers.getSetCookie()) {
    if (/^__Host-/i.test(value)) continue;
    out.append("Set-Cookie", value.replace(/;\s*Domain=[^;]*/ig, "").replace(/;\s*Path=[^;]*/ig, "; Path=/") + "; Secure");
  }
  const gameOrigin = view.kind === "web" ? upstream.headers.get("X-Farmservers-Upstream-Origin") : null;
  const location = upstream.headers.get("Location");
  if (location) {
    const target = new URL(location, g.origin);
    const rewritten = gameOrigin ? gameUrl(target.href, url.origin, gameOrigin) : target.href;
    const destination = new URL(rewritten);
    need(destination.origin === g.origin || destination.origin === url.origin, 502, "Upstream attempted an external redirect");
    const prefix = "/central/view/" + view.instance + "/" + view.kind;
    const pathname = destination.pathname.startsWith(prefix + "/") ? destination.pathname.slice(prefix.length) : destination.pathname;
    out.set("Location", url.origin + pathname + destination.search + destination.hash);
  }
  out.set("Cache-Control", "no-store");
  out.set("Referrer-Policy", "no-referrer");
  out.set("X-Content-Type-Options", "nosniff");
  out.set("Content-Security-Policy", "frame-ancestors 'none'");
  const response = new Response(upstream.body, { status: upstream.status, headers: out });
  if (gameOrigin && upstream.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() === "text/html" && !upstream.headers.has("Content-Disposition") && upstream.status !== 206 && request.method !== "HEAD") {
    return rewriteGameHtml(response, url.origin, gameOrigin);
  }
  return response;
}
__name(viewer, "viewer");
async function api(request, env, url) {
  if (url.pathname === "/api/launch") return launch(request, env, url);
  if (url.pathname.startsWith("/api/heartbeat/")) return heartbeat(request, env, url.pathname.slice(15));
  const user = await auth(request, env, "pending");
  if (url.pathname === "/api/me" && request.method === "GET") return reply({ id: user.user_id, name: user.name, role: user.role, csrf: user.csrf });
  if (url.pathname === "/api/logout" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE hash=?").bind(user.hash).run();
    return new Response(null, { status: 204, headers: { "Set-Cookie": cookie("__Host-farmservers", "", 0), "Cache-Control": "no-store" } });
  }
  need(allowed(user.role, "viewer"), 403, "An administrator must approve your account");
  if (url.pathname === "/api/nodes" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id,name,enabled,last_seen,snapshot FROM nodes ORDER BY name").all();
    return reply({ nodes: results.map((n) => ({ ...n, snapshot: n.snapshot ? JSON.parse(n.snapshot) : null, online: !!n.enabled && n.last_seen !== null && now() - n.last_seen < 120 })) });
  }
  if (url.pathname === "/api/history" && request.method === "GET") {
    const id = url.searchParams.get("node") || "", scope = url.searchParams.get("scope") || "host", hours = Number(url.searchParams.get("hours") || 1);
    need(validId(id) && validScope(scope) && [1, 6, 24, 168, 720].includes(hours), 422, "Invalid history query");
    const bucket = Math.max(30, Math.ceil(hours * 3600 / 359));
    const keys = ["cpu_percent", "memory_used_bytes", "disk_used_bytes", "network_in_bytes_sec", "network_out_bytes_sec"];
    const expressions = keys.map((k) => `AVG(json_extract(data,'$.${k}')) AS ${k}`).join(",");
    const { results } = await env.DB.prepare(`SELECT MIN(ts) AS timestamp,${expressions} FROM samples WHERE node_id=? AND scope=? AND ts>=? GROUP BY CAST(ts / ? AS INTEGER) ORDER BY timestamp`).bind(id, scope, now() - hours * 3600, bucket).all();
    return reply({ points: results });
  }
  if (url.pathname === "/api/action" && request.method === "POST") {
    need(allowed(user.role, "operator"), 403, "Operator access required");
    const body = await readJson(request, 4096);
    need(validId(body.node) && validScope(body.instance_id) && ["start", "stop", "restart", "backend_reboot", "logs"].includes(String(body.action)), 422, "Invalid action");
    need(await env.DB.prepare("SELECT id FROM nodes WHERE id=? AND enabled=1").bind(body.node).first(), 404, "Node unavailable");
    const g = gateway(env, body.node), headers = gatewayHeaders(g, user);
    headers.set("Content-Type", "application/json");
    await audit(env, user.user_id, "server." + body.action, body.node + "/" + body.instance_id);
    const result = await fetch(g.origin + "/?route=api_node_server_action", { method: "POST", headers, body: JSON.stringify({ instance_id: body.instance_id, action: body.action }), redirect: "manual", signal: AbortSignal.timeout(6e4) });
    need(result.headers.get("Content-Type")?.includes("application/json"), 502, "Node gateway returned an unexpected response");
    return new Response(result.body, { status: result.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  need(allowed(user.role, "admin"), 403, "Administrator access required");
  if (url.pathname === "/api/users" && request.method === "GET") return reply((await env.DB.prepare("SELECT id,name,role,created FROM users ORDER BY created DESC").all()).results);
  if (url.pathname === "/api/audit" && request.method === "GET") return reply((await env.DB.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 100").all()).results);
  if (url.pathname === "/api/users" && request.method === "POST") {
    const body = await readJson(request, 4096);
    need(typeof body.id === "string" && /^\d{17,20}$/.test(body.id) && roles.includes(body.role), 422, "Invalid user or role");
    need(body.id !== env.BOOTSTRAP_ADMIN_ID, 409, "The initial administrator is managed in Worker configuration");
    await env.DB.batch([env.DB.prepare("UPDATE users SET role=? WHERE id=?").bind(body.role, body.id), env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(body.id)]);
    await audit(env, user.user_id, "user." + body.role, body.id);
    return reply({ ok: true });
  }
  if (url.pathname === "/api/nodes" && request.method === "POST") {
    const body = await readJson(request, 4096);
    need(validId(body.id) && typeof body.name === "string" && body.name.length > 0 && body.name.length <= 100, 422, "Invalid node");
    const token = randomToken();
    await env.DB.prepare("INSERT INTO nodes(id,name,token_hash) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,token_hash=excluded.token_hash,enabled=1").bind(body.id, body.name, await digest(token)).run();
    await audit(env, user.user_id, "node.enroll-or-rotate", body.id);
    return reply({ id: body.id, token, notice: "Save this token on the node; it is shown only once." });
  }
  if (url.pathname === "/api/nodes/disable" && request.method === "POST") {
    const body = await readJson(request, 4096);
    need(validId(body.id), 422, "Invalid node");
    await env.DB.prepare("UPDATE nodes SET enabled=0 WHERE id=?").bind(body.id).run();
    await audit(env, user.user_id, "node.disable", body.id);
    return reply({ ok: true });
  }
  throw new HttpError(404, "Not found");
}
__name(api, "api");
var index_default = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.hostname.endsWith("." + new URL(env.APP_ORIGIN).hostname) && /^view-[a-f0-9]{24}\./.test(url.hostname)) return await viewer(request, env, url);
      need(url.origin === env.APP_ORIGIN, 404, "Unknown host");
      let response;
      if (url.pathname.startsWith("/auth/")) response = await oauth(request, env, url);
      else if (url.pathname.startsWith("/api/")) response = await api(request, env, url);
      else {
        need(["GET", "HEAD"].includes(request.method), 405, "Method not allowed");
        response = await env.ASSETS.fetch(request);
      }
      const headers = new Headers(response.headers);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      headers.set("Strict-Transport-Security", "max-age=31536000");
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      return reply({ error: error instanceof HttpError ? error.message : "Request failed; check service configuration" }, error instanceof HttpError ? error.status : 500);
    }
  },
  async scheduled(_event, env) {
    await env.DB.batch([
      ...["oauth_states", "sessions", "tickets", "views"].map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE expires<?`).bind(now())),
      env.DB.prepare("DELETE FROM samples WHERE ts<?").bind(now() - 30 * 86400),
      env.DB.prepare("DELETE FROM audit WHERE ts<?").bind(now() - 90 * 86400)
    ]);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
