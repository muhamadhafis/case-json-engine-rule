/**
 * cek2role.js
 * Cari UID yang punya tepat 2 role/grup di LDAP API
 *
 * Usage: node cek2role.js
 */

const axios = require("axios");
const https = require("https");

// Konfigurasi endpoint
const LDAP_GROUPS_URL = "https://mirorim.ddns.net:6789/ldapapi/groups";

// Jika SSL self-signed
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Ambil semua groups dari API
 */
async function fetchGroups() {
  const { data } = await axios.get(LDAP_GROUPS_URL, { httpsAgent });
  return Array.isArray(data) ? data : [data];
}

/**
 * Ambil UID dari memberUid string
 * contoh: "uid=2007006,uid=04002,uid=97002,ou=users,dc=..."
 * return: "2007006"
 */
function extractUid(dn) {
  if (!dn || typeof dn !== "string") return null;
  const match = dn.match(/^uid=([^,]+)/i);
  return match ? match[1] : null;
}

async function main() {
  try {
    console.log("🔎 Ambil semua groups dari LDAP...");
    const groups = await fetchGroups();

    // Map: uid -> set of groups
    const uidRoles = {};

    for (const g of groups) {
      const cn = g.cn || g.dn || "UNKNOWN_GROUP";
      const members = Array.isArray(g.memberUid)
        ? g.memberUid
        : g.memberUid
        ? [g.memberUid]
        : [];

      for (const m of members) {
        const uid = extractUid(m);
        if (uid) {
          if (!uidRoles[uid]) uidRoles[uid] = new Set();
          uidRoles[uid].add(cn);
        }
      }
    }

    // Filter yang punya tepat 2 role
    const result = Object.entries(uidRoles)
      .filter(([uid, roles]) => roles.size === 2)
      .map(([uid, roles]) => ({ uid, roles: Array.from(roles) }));

    if (result.length === 0) {
      console.log("❌ Tidak ada UID dengan tepat 2 role.");
    } else {
      console.log("✅ UID dengan tepat 2 role:");
      result.forEach((r) => {
        console.log(`- ${r.uid}: ${r.roles.join(", ")}`);
      });
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

main();
