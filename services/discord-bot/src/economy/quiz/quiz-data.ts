// The questions behind the three guessing games. Plain data, no dependencies.

export type QuizKind = "flag" | "map" | "logo";

export type Country = {
  /** ISO 3166-1 alpha-2 code, used for the flag picture. */
  code: string;
  /** Name shown on the answer buttons. */
  name: string;
  /** ISO 3166-1 numeric code, used to find the country on the world map.
   *  Left out for small countries that are too tiny to see on the map. */
  numeric?: number;
};

// [code, numeric (0 = flag only), name]
const COUNTRY_ROWS: Array<[string, number, string]> = [
  ["AF", 4, "Afghanistan"], ["AL", 8, "Albania"], ["DZ", 12, "Algeria"],
  ["AO", 24, "Angola"], ["AR", 32, "Argentina"], ["AM", 51, "Armenia"],
  ["AU", 36, "Australia"], ["AT", 40, "Austria"], ["AZ", 31, "Azerbaijan"],
  ["BS", 44, "Bahamas"], ["BD", 50, "Bangladesh"], ["BY", 112, "Belarus"],
  ["BE", 56, "Belgium"], ["BZ", 84, "Belize"], ["BJ", 204, "Benin"],
  ["BT", 64, "Bhutan"], ["BO", 68, "Bolivia"], ["BA", 70, "Bosnia and Herzegovina"],
  ["BW", 72, "Botswana"], ["BR", 76, "Brazil"], ["BG", 100, "Bulgaria"],
  ["BF", 854, "Burkina Faso"], ["BI", 108, "Burundi"], ["KH", 116, "Cambodia"],
  ["CM", 120, "Cameroon"], ["CA", 124, "Canada"], ["CF", 140, "Central African Republic"],
  ["TD", 148, "Chad"], ["CL", 152, "Chile"], ["CN", 156, "China"],
  ["CO", 170, "Colombia"], ["CG", 178, "Republic of the Congo"], ["CD", 180, "DR Congo"],
  ["CR", 188, "Costa Rica"], ["CI", 384, "Ivory Coast"], ["HR", 191, "Croatia"],
  ["CU", 192, "Cuba"], ["CY", 196, "Cyprus"], ["CZ", 203, "Czechia"],
  ["DK", 208, "Denmark"], ["DJ", 262, "Djibouti"], ["DO", 214, "Dominican Republic"],
  ["EC", 218, "Ecuador"], ["EG", 818, "Egypt"], ["SV", 222, "El Salvador"],
  ["GQ", 226, "Equatorial Guinea"], ["ER", 232, "Eritrea"], ["EE", 233, "Estonia"],
  ["ET", 231, "Ethiopia"], ["FJ", 242, "Fiji"], ["FI", 246, "Finland"],
  ["FR", 250, "France"], ["GA", 266, "Gabon"], ["GM", 270, "Gambia"],
  ["GE", 268, "Georgia"], ["DE", 276, "Germany"], ["GH", 288, "Ghana"],
  ["GR", 300, "Greece"], ["GT", 320, "Guatemala"], ["GN", 324, "Guinea"],
  ["GW", 624, "Guinea-Bissau"], ["GY", 328, "Guyana"], ["HT", 332, "Haiti"],
  ["HN", 340, "Honduras"], ["HU", 348, "Hungary"], ["IS", 352, "Iceland"],
  ["IN", 356, "India"], ["ID", 360, "Indonesia"], ["IR", 364, "Iran"],
  ["IQ", 368, "Iraq"], ["IE", 372, "Ireland"], ["IL", 376, "Israel"],
  ["IT", 380, "Italy"], ["JM", 388, "Jamaica"], ["JP", 392, "Japan"],
  ["JO", 400, "Jordan"], ["KZ", 398, "Kazakhstan"], ["KE", 404, "Kenya"],
  ["KW", 414, "Kuwait"], ["KG", 417, "Kyrgyzstan"], ["LA", 418, "Laos"],
  ["LV", 428, "Latvia"], ["LB", 422, "Lebanon"], ["LS", 426, "Lesotho"],
  ["LR", 430, "Liberia"], ["LY", 434, "Libya"], ["LT", 440, "Lithuania"],
  ["LU", 442, "Luxembourg"], ["MG", 450, "Madagascar"], ["MW", 454, "Malawi"],
  ["MY", 458, "Malaysia"], ["ML", 466, "Mali"], ["MR", 478, "Mauritania"],
  ["MX", 484, "Mexico"], ["MD", 498, "Moldova"], ["MN", 496, "Mongolia"],
  ["ME", 499, "Montenegro"], ["MA", 504, "Morocco"], ["MZ", 508, "Mozambique"],
  ["MM", 104, "Myanmar"], ["NA", 516, "Namibia"], ["NP", 524, "Nepal"],
  ["NL", 528, "Netherlands"], ["NZ", 554, "New Zealand"], ["NI", 558, "Nicaragua"],
  ["NE", 562, "Niger"], ["NG", 566, "Nigeria"], ["KP", 408, "North Korea"],
  ["MK", 807, "North Macedonia"], ["NO", 578, "Norway"], ["OM", 512, "Oman"],
  ["PK", 586, "Pakistan"], ["PA", 591, "Panama"], ["PG", 598, "Papua New Guinea"],
  ["PY", 600, "Paraguay"], ["PE", 604, "Peru"], ["PH", 608, "Philippines"],
  ["PL", 616, "Poland"], ["PT", 620, "Portugal"], ["QA", 634, "Qatar"],
  ["RO", 642, "Romania"], ["RU", 643, "Russia"], ["RW", 646, "Rwanda"],
  ["SA", 682, "Saudi Arabia"], ["SN", 686, "Senegal"], ["RS", 688, "Serbia"],
  ["SL", 694, "Sierra Leone"], ["SK", 703, "Slovakia"], ["SI", 705, "Slovenia"],
  ["SO", 706, "Somalia"], ["ZA", 710, "South Africa"], ["KR", 410, "South Korea"],
  ["SS", 728, "South Sudan"], ["ES", 724, "Spain"], ["LK", 144, "Sri Lanka"],
  ["SD", 729, "Sudan"], ["SR", 740, "Suriname"], ["SE", 752, "Sweden"],
  ["CH", 756, "Switzerland"], ["SY", 760, "Syria"], ["TW", 158, "Taiwan"],
  ["TJ", 762, "Tajikistan"], ["TZ", 834, "Tanzania"], ["TH", 764, "Thailand"],
  ["TL", 626, "Timor-Leste"], ["TG", 768, "Togo"], ["TT", 780, "Trinidad and Tobago"],
  ["TN", 788, "Tunisia"], ["TR", 792, "Turkey"], ["TM", 795, "Turkmenistan"],
  ["UG", 800, "Uganda"], ["UA", 804, "Ukraine"], ["AE", 784, "United Arab Emirates"],
  ["GB", 826, "United Kingdom"], ["US", 840, "United States"], ["UY", 858, "Uruguay"],
  ["UZ", 860, "Uzbekistan"], ["VE", 862, "Venezuela"], ["VN", 704, "Vietnam"],
  ["YE", 887, "Yemen"], ["ZM", 894, "Zambia"], ["ZW", 716, "Zimbabwe"],
  // Flag only: too small to recognise on a world map.
  ["SG", 0, "Singapore"], ["BH", 0, "Bahrain"], ["MT", 0, "Malta"],
  ["MC", 0, "Monaco"], ["MV", 0, "Maldives"], ["MU", 0, "Mauritius"],
  ["BN", 0, "Brunei"], ["PS", 0, "Palestine"],
];

export const COUNTRIES: readonly Country[] = COUNTRY_ROWS.map(([code, numeric, name]) =>
  numeric > 0 ? { code, name, numeric } : { code, name },
);

export type Brand = {
  /** Export name in the `simple-icons` package, for example "siGoogle". */
  icon: string;
  /** Name shown on the answer buttons. */
  name: string;
};

// A brand whose icon is missing from the installed simple-icons version is
// skipped automatically at startup, so a few extra entries are harmless.
export const BRANDS: readonly Brand[] = [
  { icon: "siGoogle", name: "Google" }, { icon: "siApple", name: "Apple" },
  { icon: "siSpotify", name: "Spotify" }, { icon: "siNetflix", name: "Netflix" },
  { icon: "siYoutube", name: "YouTube" }, { icon: "siInstagram", name: "Instagram" },
  { icon: "siFacebook", name: "Facebook" }, { icon: "siTesla", name: "Tesla" },
  { icon: "siBmw", name: "BMW" }, { icon: "siFerrari", name: "Ferrari" },
  { icon: "siNike", name: "Nike" }, { icon: "siAdidas", name: "Adidas" },
  { icon: "siPuma", name: "Puma" }, { icon: "siPlaystation", name: "PlayStation" },
  { icon: "siNintendo", name: "Nintendo" }, { icon: "siDiscord", name: "Discord" },
  { icon: "siTwitch", name: "Twitch" }, { icon: "siTiktok", name: "TikTok" },
  { icon: "siReddit", name: "Reddit" }, { icon: "siWhatsapp", name: "WhatsApp" },
  { icon: "siTelegram", name: "Telegram" }, { icon: "siSnapchat", name: "Snapchat" },
  { icon: "siPinterest", name: "Pinterest" }, { icon: "siStarbucks", name: "Starbucks" },
  { icon: "siMcdonalds", name: "McDonald's" }, { icon: "siCocacola", name: "Coca-Cola" },
  { icon: "siSamsung", name: "Samsung" }, { icon: "siIntel", name: "Intel" },
  { icon: "siNvidia", name: "NVIDIA" }, { icon: "siAmd", name: "AMD" },
  { icon: "siFirefoxbrowser", name: "Firefox" }, { icon: "siAndroid", name: "Android" },
  { icon: "siGithub", name: "GitHub" }, { icon: "siDocker", name: "Docker" },
  { icon: "siPython", name: "Python" }, { icon: "siMercedes", name: "Mercedes-Benz" },
  { icon: "siAudi", name: "Audi" }, { icon: "siToyota", name: "Toyota" },
  { icon: "siHonda", name: "Honda" }, { icon: "siFord", name: "Ford" },
  { icon: "siPorsche", name: "Porsche" }, { icon: "siLamborghini", name: "Lamborghini" },
  { icon: "siUber", name: "Uber" }, { icon: "siAirbnb", name: "Airbnb" },
  { icon: "siPaypal", name: "PayPal" }, { icon: "siVisa", name: "Visa" },
  { icon: "siMastercard", name: "Mastercard" }, { icon: "siShopify", name: "Shopify" },
  { icon: "siSteam", name: "Steam" }, { icon: "siXbox", name: "Xbox" },
  { icon: "siDropbox", name: "Dropbox" }, { icon: "siFigma", name: "Figma" },
  { icon: "siIkea", name: "IKEA" }, { icon: "siLego", name: "LEGO" },
  { icon: "siRedbull", name: "Red Bull" }, { icon: "siVolkswagen", name: "Volkswagen" },
  { icon: "siRenault", name: "Renault" }, { icon: "siPeugeot", name: "Peugeot" },
  { icon: "siChevrolet", name: "Chevrolet" }, { icon: "siHyundai", name: "Hyundai" },
  { icon: "siKia", name: "Kia" }, { icon: "siSony", name: "Sony" },
  { icon: "siLinkedin", name: "LinkedIn" }, { icon: "siX", name: "X" },
  { icon: "siWikipedia", name: "Wikipedia" }, { icon: "siOpenai", name: "OpenAI" },
];
