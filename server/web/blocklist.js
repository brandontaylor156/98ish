// Sites Compass never opens: not through the relay, not straight in its frame, not as a saved
// copy (GET /frame says "blocked" and Compass shows a page saying so).
//
// Two parts:
//  - the owner's list, WEB_BLOCK_HOSTS ("a.com,b.org": those hosts and their subdomains);
//  - a small built-in list by category. It is deliberately COMPACT and best effort: a few
//    hundred bytes of the best-known hosts plus a host-name heuristic, not a full filter.
//    Free public-domain adult blocklists exist (e.g. the Block List Project, Unlicense) but run
//    to hundreds of thousands of hosts, far too big to ship and keep in memory here. So:
//      malware   well-known malware/phishing TEST and sample sites (relaying their files would
//                put malware through the 98ish server)
//      adult     the biggest adult sites, adult-only top-level domains (.xxx .porn .adult .sex)
//                and host names containing an unmistakable adult word (porn, xxx, hentai...).
//                "sex" alone is NOT a keyword (Sussex, Essex, Middlesex...)
//      piracy    the best-known torrent/piracy/shadow-library sites (copyright complaints are
//                the most common kind sent to anyone who runs a proxy)
//      proxy     other web proxies, anonymizers and Tor gateways (no proxy chains through 98ish)
//    Limits: a site that isn't on the list and has an innocent name gets through; a harmless
//    site whose name contains one of the words is refused. Reports (Compass > Tools > Report
//    This Page) are how the owner hears about the first kind; WEB_BLOCK_HOSTS adds them.

const CATEGORIES = {
  malware: ["testsafebrowsing.appspot.com", "malware.testing.google.test", "wicar.org", "ianfette.org", "eicar.org", "amtso.org", "malware-traffic-analysis.net", "vxvault.net", "bazaar.abuse.ch", "virusshare.com", "vx-underground.org"],
  adult: ["pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "redtube.com", "youporn.com", "tube8.com", "spankbang.com", "eporner.com", "txxx.com", "beeg.com", "motherless.com", "onlyfans.com", "fansly.com", "chaturbate.com", "stripchat.com", "bongacams.com", "livejasmin.com", "camsoda.com", "myfreecams.com", "cam4.com", "brazzers.com", "realitykings.com", "erome.com", "rule34.xxx", "e621.net", "nhentai.net", "hanime.tv", "literotica.com", "adultfriendfinder.com", "fetlife.com", "manyvids.com", "clips4sale.com", "f95zone.to"],
  piracy: ["thepiratebay.org", "1337x.to", "1337x.st", "1337x.tw", "rarbg.to", "yts.mx", "yts.am", "yts.lt", "nyaa.si", "torrentgalaxy.to", "limetorrents.lol", "eztv.re", "eztvx.to", "kickasstorrents.to", "fitgirl-repacks.site", "libgen.is", "libgen.rs", "libgen.li", "z-lib.org", "z-lib.io", "z-library.sk", "singlelogin.re", "sci-hub.se", "sci-hub.ru", "sci-hub.st", "annas-archive.org", "annas-archive.se", "soap2day.to", "fmovies.to", "123movies.to", "gogoanime.tv", "9anime.to", "aniwave.to"],
  proxy: ["croxyproxy.com", "croxy.network", "proxysite.com", "proxyium.com", "kproxy.com", "hidester.com", "hide.me", "4everproxy.com", "blockaway.net", "proxyscrape.com", "plainproxies.com", "megaproxy.com", "tor2web.org", "onion.ws", "onion.ly", "onion.pet", "onion.to", "onion.city", "onion.cab"],
}
const ADULT_TLDS = new Set(["xxx", "porn", "adult", "sex", "sexy"])
const ADULT_WORDS = /(porn|xxx|hentai|nsfw|xvideo|xnxx|xhamster|sexcam|livesex|camgirl|onlyfans|fansly|chaturbate|stripchat|bongacams|camsoda|spankbang|brazzers|nhentai|redtube|youporn)/

const MESSAGES = {
  owner: "The owner of this 98ish server has blocked this site in Compass.",
  malware: "Compass doesn't open sites that spread or test malware.",
  adult: "Compass doesn't open adult sites.",
  piracy: "Compass doesn't open file-sharing and piracy sites.",
  proxy: "Compass doesn't open other web proxies or anonymizers.",
}

const clean = (host) => String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "").replace(/:\d+$/, "")
const under = (host, list) => list.some((d) => host === d || host.endsWith("." + d))

// "a.com, .b.org" -> ["a.com", "b.org"]
const parseHosts = (text) =>
  String(text || "")
    .split(",")
    .map((s) => clean(s.trim().replace(/^\*?\./, "")))
    .filter(Boolean)

// -> { category, message } | null
const blockedSite = (input, ownerList = []) => {
  const host = clean(input)
  if (!host) return null
  if (under(host, ownerList)) return { category: "owner", message: MESSAGES.owner }
  for (const [category, list] of Object.entries(CATEGORIES)) if (under(host, list)) return { category, message: MESSAGES[category] }
  const labels = host.split(".")
  if (ADULT_TLDS.has(labels.at(-1)) || ADULT_WORDS.test(labels.slice(0, -1).join("."))) return { category: "adult", message: MESSAGES.adult }
  return null
}

module.exports = { blockedSite, parseHosts, CATEGORIES, MESSAGES }
