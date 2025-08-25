const { Client, logger } = require("camunda-external-task-client-js");
const { Engine } = require("json-rules-engine");
const axios = require("axios");
const https = require("https");

// api
const CAMUNDA_BASE_URL = "http://192.168.1.85:8080/engine-rest";
const LDAP_API_BASE = "https://mirorim.ddns.net:6789/ldapapi";

const camunda = new Client({ baseUrl: CAMUNDA_BASE_URL, use: logger });

// Axios instance untuk LDAP API
const http = axios.create({
  baseURL: LDAP_API_BASE,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 10000,
});

// get unik user ldap
async function fetchUserByAssignee(uid) {
  // GET /users?filter={uid}
  const url = `/users?filter=${encodeURIComponent(uid)}`;

  const { data } = await http.get(url);

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`User dengan uid=${uid} tidak ditemukan dari API users`);
  }

  // Asumsikan baris pertama adalah yang relevan
  return data[0];
}

// get all groups ldap
async function fetchAllGroups() {
  // GET /groups (tanpa filter, supaya bisa scan semua kelompok)

  const url = `/groups`;
  const { data } = await http.get(url);

  // Normalisasi menjadi array of groups.
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return [data];
  return [];
}

// ---------- Util: Cari groups yang berisi uid di memberUid ----------
function extractUserGroupsFromList(groups, uid) {
  const needle = `uid=${uid},`; // pola pembuka
  const userGroups = [];

  for (const g of groups) {
    const members = Array.isArray(g.memberUid) ? g.memberUid : [];
    const match = members.some(
      (m) => typeof m === "string" && m.startsWith(needle)
    );
    if (match) {
      userGroups.push({
        cn: g.cn, // nama
        dn: g.dn, // group
        gidNumber: g.gidNumber,
      });
    }
  }
  return userGroups;
}

// ---------- RULES: json-rules-engine ----------
function buildRules() {
  // Menentukan secondRole = true jika totalRoles >= 2
  return [
    {
      conditions: {
        all: [
          { fact: "assignee", operator: "notEqual", value: "" },
          { fact: "totalRoles", operator: "greaterThanInclusive", value: 2 },
        ],
      },
      event: { type: "SECOND_ROLE_TRUE", params: { secondRole: true } },
    },
  ];
}

// check role
camunda.subscribe("check-roles", async ({ task, taskService }) => {
  try {
    const assignee = task.variables.get("assignee"); // string uid
    if (!assignee || typeof assignee !== "string") {
      throw new Error("Variable 'assignee' tidak ada atau bukan string");
    }

    // Ambil data LDAP
    const user = await fetchUserByAssignee(assignee);
    const allGroups = await fetchAllGroups();
    const userGroups = extractUserGroupsFromList(allGroups, assignee);

    // Hitung jumlah role
    const totalRoles = userGroups.length;

    // Default secondRole = false
    let secondRole = false;

    // Kalau role lebih dari 1, ubah jadi true
    if (totalRoles >= 2) {
      secondRole = true;
    }

    // Update variable ke Camunda
    await taskService.complete(task, {
      secondRole: secondRole,
    });

    console.log("===== [check-roles] Evaluasi =====");
    console.log("Assignee    :", assignee);
    console.log("Total Roles :", totalRoles);
    console.log("secondRole  :", secondRole);
    console.log("==================================");
  } catch (err) {
    console.error("❌ [check-roles] Error:", err.message);
    await taskService.handleFailure(task, {
      errorMessage: err.message,
      errorDetails: err.stack,
      retries: 3,
      retryTimeout: 5000,
    });
  }
});

// ldap json
camunda.subscribe("ldap-json", async ({ task, taskService }) => {
  try {
    const assignee = task.variables.get("assignee");
    const secondRole = task.variables.get("secondRole");

    console.log("===== [ldap-json] Multiple role =====");
    console.log("Assignee   :", assignee);
    console.log("secondRole :", secondRole);
    console.log("=====================================");

    await taskService.complete(task, {
      ruleResult: "User memiliki >= 2 role",
    });
  } catch (err) {
    console.error("❌ [ldap-json] Error:", err.message);
    await taskService.handleFailure(task, {
      errorMessage: err.message,
      errorDetails: err.stack,
      retries: 3,
      retryTimeout: 5000,
    });
  }
});

// ldap json negatif
camunda.subscribe("ldap-json-negatif", async ({ task, taskService }) => {
  try {
    const assignee = task.variables.get("assignee");
    const secondRole = task.variables.get("secondRole");

    console.log("===== [ldap-json-negatif] Single role =====");
    console.log("Assignee   :", assignee);
    console.log("secondRole :", secondRole);
    console.log("==========================================");

    await taskService.complete(task, {
      ruleResult: "User memiliki < 2 role",
    });
  } catch (err) {
    console.error("❌ [ldap-json-negatif] Error:", err.message);
    await taskService.handleFailure(task, {
      errorMessage: err.message,
      errorDetails: err.stack,
      retries: 3,
      retryTimeout: 5000,
    });
  }
});
