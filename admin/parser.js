/* Scoutbook "Merit Badge In-Progress Report" CSV -> tracker data.json
 * Runs entirely client-side (no server). Faithful JS port of the reference
 * Python parser used to build the original data set -- verified to produce
 * matching output field-for-field against known-good CSV exports.
 *
 * Exposes: window.TrackerParser.build(files) -> Promise<dataObject>
 *   files: array of { name, text } for each uploaded CSV
 */
(function (global) {
  "use strict";

  const REQUIRED_FIXED = [
    "Camping", "Citizenship in the Community", "Citizenship in the Nation",
    "Citizenship in the World", "Communication", "Cooking", "Family Life",
    "First Aid", "Personal Fitness", "Personal Management",
  ];

  const ALT_GROUPS = {
    "Fitness (choose 1)": ["Cycling", "Hiking", "Swimming"],
    "Safety (choose 1)": ["Emergency Preparedness", "Lifesaving"],
    "Environment (choose 1)": ["Environmental Science", "Sustainability"],
  };

  const CANON_BADGES = [
    "American Business","American Cultures","American Heritage","American Indian Culture",
    "American Labor","Animal Science","Animation","Archaeology","Archery","Architecture",
    "Art","Artificial Intelligence","Astronomy","Athletics","Automotive Maintenance","Aviation",
    "Backpacking","Basketry","Bird Study","Bugling","Camping","Canoeing","Chemistry","Chess",
    "Citizenship in Society","Citizenship in the Community","Citizenship in the Nation",
    "Citizenship in the World","Climbing","Coin Collecting","Collections","Communication",
    "Competitive Gaming","Composite Materials","Cooking","Crime Prevention","Cybersecurity",
    "Cycling","Dentistry","Digital Technology","Disabilities Awareness","Dog Care","Drafting",
    "Electricity","Electronics","Emergency Preparedness","Energy","Engineering","Entrepreneurship",
    "Environmental Science","Exploration","Family Life","Farm Mechanics","Fingerprinting",
    "Fire Safety","First Aid","Fish & Wildlife Management","Fishing","Fly Fishing","Forestry",
    "Game Design","Gardening","Genealogy","Geocaching","Geology","Golf","Graphic Arts",
    "Health Care Professions","Hiking","Home Repairs","Horsemanship","Insect Study","Inventing",
    "Journalism","Kayaking","Landscape Architecture","Law","Leatherwork","Lifesaving",
    "Mammal Study","Metalwork","Mining in Society","Model Design and Building","Motorboating",
    "Moviemaking","Multisport","Music","Nature","Nuclear Science","Oceanography","Orienteering",
    "Painting","Personal Fitness","Personal Management","Pets","Photography","Pioneering",
    "Plant Science","Plumbing","Pottery","Programming","Public Health","Public Speaking",
    "Pulp and Paper","Radio","Railroading","Reading","Reptile and Amphibian Study",
    "Rifle Shooting","Robotics","Rowing","Safety","Salesmanship","Scholarship",
    "Scouting Heritage","Scuba Diving","Sculpture","Search and Rescue","Shotgun Shooting",
    "Signs, Signals, and Codes","Skating","Small-Boat Sailing","Snow Sports",
    "Soil and Water Conservation","Space Exploration","Sports","Stamp Collecting","Surveying",
    "Sustainability","Swimming","Textile","Theater","Traffic Safety","Truck Transportation",
    "Veterinary Medicine","Water Sports","Weather","Welding","Whitewater","Wilderness Survival",
    "Wood Carving","Woodwork",
  ];

  const ABBREV = {
    "Amer. Heritage": "American Heritage",
    "Automotive Maint.": "Automotive Maintenance",
    "Cit. in Comm.": "Citizenship in the Community",
    "Cit. in Nation": "Citizenship in the Nation",
    "Cit. in World": "Citizenship in the World",
    "Composite Mat.": "Composite Materials",
    "Digital Tech": "Digital Technology",
    "Disabilities Awar.": "Disabilities Awareness",
    "Emergency Prep.": "Emergency Preparedness",
    "Enviro. Science": "Environmental Science",
    "Pers. Fitness": "Personal Fitness",
    "Personal Mgmt.": "Personal Management",
    "Reptile and Amph.": "Reptile and Amphibian Study",
    "Scout Heritage": "Scouting Heritage",
    "Signs Signals Codes": "Signs, Signals, and Codes",
    "Soil and Water Con.": "Soil and Water Conservation",
    "Wilderness Surv.": "Wilderness Survival",
  };

  const SECTION_MAP = {
    "In-Progress Merit Badge": "in_progress",
    "Completed - not MBC approved Merit Badge": "completed",
    "MBC Approved Merit Badge": "mbc_approved",
    "Approved or Awarded Merit Badge": "approved",
  };

  function canonBadgeName(raw) {
    let name = raw.replace(/\s*\(\d{4}\)\s*$/, "").trim();
    return ABBREV[name] || name;
  }

  function cleanFirstName(first) {
    return first.replace(/\s*\([^)]*\)\s*$/, "").trim();
  }

  function cleanRemaining(raw) {
    let s = raw.trim();
    s = s.replace(/(,\s*)+,/g, ",");     // collapse runs of repeated commas
    s = s.replace(/,(?!\s)/g, ", ");      // ensure a space follows every comma
    s = s.replace(/\s{2,}/g, " ");        // collapse doubled whitespace
    s = s.replace(/,\s*$/, "");           // strip trailing comma
    return s;
  }

  // Minimal RFC4180-ish CSV line parser (handles quoted fields with embedded commas)
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      } else {
        if (c === '"') { inQuotes = true; i++; continue; }
        if (c === ",") { row.push(field); field = ""; i++; continue; }
        if (c === "\r") { i++; continue; }
        if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
        field += c; i++; continue;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function parseTroopCSV(text) {
    // strip BOM if present
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = parseCSV(text);

    let troopNum = null, troopGender = null;
    const m = text.match(/Troop\s+0*(\d+)\s+(BOYS|GIRLS)/i);
    if (m) {
      troopNum = parseInt(m[1], 10);
      troopGender = m[2].toUpperCase() === "BOYS" ? "Boys" : "Girls";
    }
    let genDate = null;
    const gm = text.match(/Generated:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (gm) genDate = `${gm[3]}-${gm[1]}-${gm[2]}`;

    let section = null;
    const out = { in_progress: [], completed: [], mbc_approved: [], approved: [] };
    for (const row of rows) {
      if (!row.length || !row.some(c => c.trim())) continue;
      const first = (row[0] || "").trim();
      if (SECTION_MAP[first]) { section = SECTION_MAP[first]; continue; }
      if (first === "Member ID") continue;
      if (section && /^\d+$/.test(first)) out[section].push(row);
    }
    return { troopNum, troopGender, genDate, sections: out };
  }

  function dateKey(d) {
    if (!d) return [0, 0, 0];
    const parts = d.split("/");
    if (parts.length !== 3) return [0, 0, 0];
    const [mo, da, yr] = parts.map(x => parseInt(x, 10));
    return [yr || 0, mo || 0, da || 0];
  }
  function cmpDateDesc(a, b) {
    const ka = dateKey(a.date), kb = dateKey(b.date);
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  }

  function isRequiredBadge(badge) {
    if (REQUIRED_FIXED.includes(badge)) return true;
    for (const g in ALT_GROUPS) if (ALT_GROUPS[g].includes(badge)) return true;
    return false;
  }

  function build(files) {
    // files: [{name, text}]
    const scouts = new Map(); // member_id -> record
    const exportDates = [];
    const troopLabels = []; // [num, gender]

    function getScout(mid, first, last, rank, troopNum) {
      if (!scouts.has(mid)) {
        scouts.set(mid, {
          member_id: mid,
          name: `${cleanFirstName(first)} ${last.trim()}`,
          troop: troopNum,
          rank: rank.trim(),
          approved: {},   // badge -> {date, mbc}
          awaiting: [],
          in_progress: [],
        });
      } else if (rank.trim()) {
        scouts.get(mid).rank = rank.trim();
      }
      return scouts.get(mid);
    }

    for (const file of files) {
      const { troopNum, troopGender, genDate, sections } = parseTroopCSV(file.text);
      troopLabels.push([troopNum, troopGender]);
      if (genDate) exportDates.push(genDate);

      for (const row of sections.in_progress) {
        const mid = parseInt(row[0], 10);
        const [_, first, last, mbc, rank, loc, badgeRaw, reqs] = row;
        const rec = getScout(mid, first, last, rank, troopNum);
        const badge = canonBadgeName(badgeRaw);
        rec.in_progress.push({
          badge, mbc: (mbc || "").trim(), remaining: cleanRemaining(reqs || ""),
          required: isRequiredBadge(badge),
        });
      }

      for (const [stageKey, stageLabel] of [["completed", "Completed"], ["mbc_approved", "MBC Approved"]]) {
        for (const row of sections[stageKey]) {
          const mid = parseInt(row[0], 10);
          const first = row[1], last = row[2], mbc = row[3], rank = row[8];
          const badgeRaw = row[10], dateCompleted = row[11];
          const rec = getScout(mid, first, last, rank, troopNum);
          const badge = canonBadgeName(badgeRaw);
          rec.awaiting.push({
            badge, mbc: (mbc || "").trim(), date: (dateCompleted || "").trim() || null,
            stage: stageLabel, required: isRequiredBadge(badge),
          });
        }
      }

      for (const row of sections.approved) {
        const mid = parseInt(row[0], 10);
        const first = row[1], last = row[2], mbc = row[3], rank = row[8];
        const badgeRaw = row[10], dateCompleted = row[11];
        const rec = getScout(mid, first, last, rank, troopNum);
        const badge = canonBadgeName(badgeRaw);
        if (!(badge in rec.approved)) {
          rec.approved[badge] = { date: (dateCompleted || "").trim() || null, mbc: (mbc || "").trim() };
        }
      }
    }

    // finalize per-scout derived lists
    for (const rec of scouts.values()) {
      // pure electives: not required_fixed, not in any alt-group at all
      const electives = Object.keys(rec.approved)
        .filter(b => !REQUIRED_FIXED.includes(b) && !Object.values(ALT_GROUPS).some(opts => opts.includes(b)))
        .map(b => ({ badge: b, date: rec.approved[b].date }));
      // "extra" alt-group badges: a scout who earned more than one option in a choose-one
      // group (e.g. both Cycling and Swimming) only gets one counted toward the Eagle
      // checklist; the rest still count as earned badges and belong in the "other badges"
      // list so they're visible somewhere.
      for (const opts of Object.values(ALT_GROUPS)) {
        const earnedInGroup = opts.filter(o => o in rec.approved);
        for (const extra of earnedInGroup.slice(1)) {
          electives.push({ badge: extra, date: rec.approved[extra].date });
        }
      }
      electives.sort(cmpDateDesc);
      rec.elective_earned = electives;
      rec.in_progress.sort((a, b) => a.badge.localeCompare(b.badge));
    }

    // badge catalog / category assignment
    const badgeIndex = {};
    for (const name of CANON_BADGES) badgeIndex[name] = { name, scouts: [] };
    for (const name of REQUIRED_FIXED) {
      badgeIndex[name].category = "required_fixed";
      badgeIndex[name].required_group = null;
    }
    for (const gname in ALT_GROUPS) {
      const slug = gname.replace(/\s*\(choose.*/i, "").trim().toLowerCase();
      for (const o of ALT_GROUPS[gname]) {
        badgeIndex[o].category = `alt_${slug}`;
        badgeIndex[o].required_group = gname;
      }
    }
    for (const name of CANON_BADGES) {
      if (!badgeIndex[name].category) {
        badgeIndex[name].category = "elective";
        badgeIndex[name].required_group = null;
      }
    }

    const finalScouts = [];
    for (const [mid, rec] of scouts.entries()) {
      const checklist = [];
      let er = 0;
      for (const badge of REQUIRED_FIXED) {
        const done = badge in rec.approved;
        if (done) er++;
        checklist.push({ type: "single", badge, done, date: done ? rec.approved[badge].date : null });
      }
      for (const gname in ALT_GROUPS) {
        const earnedAll = ALT_GROUPS[gname].filter(o => o in rec.approved);
        const earnedOpt = earnedAll.length ? earnedAll[0] : null;
        const earnedDate = earnedOpt ? rec.approved[earnedOpt].date : null;
        if (earnedOpt) er++;
        checklist.push({ type: "group", group: gname, options: ALT_GROUPS[gname], earned: earnedOpt, date: earnedDate, earned_options: earnedAll });
      }
      const total = Object.keys(rec.approved).length;
      const eagleReady = checklist.every(item => item.type === "single" ? item.done : item.earned !== null);

      finalScouts.push({
        member_id: parseInt(mid, 10),
        name: rec.name,
        troop: rec.troop,
        rank: rec.rank,
        total, er,
        need_er: Math.max(0, 13 - er),
        need_total: Math.max(0, 21 - total),
        eagle_ready: eagleReady,
        required_checklist: checklist,
        awaiting_signoff: rec.awaiting,
        in_progress: rec.in_progress,
        elective_earned: rec.elective_earned,
      });

      for (const badge in rec.approved) {
        if (badgeIndex[badge]) {
          badgeIndex[badge].scouts.push({
            name: rec.name, troop: rec.troop, status: "earned",
            date: rec.approved[badge].date, mbc: rec.approved[badge].mbc,
          });
        }
      }
      for (const a of rec.awaiting) {
        if (badgeIndex[a.badge]) {
          badgeIndex[a.badge].scouts.push({
            name: rec.name, troop: rec.troop, status: "ready", stage: a.stage, mbc: a.mbc,
          });
        }
      }
      for (const p of rec.in_progress) {
        if (badgeIndex[p.badge]) {
          badgeIndex[p.badge].scouts.push({
            name: rec.name, troop: rec.troop, status: "progress", remaining: p.remaining, mbc: p.mbc,
          });
        }
      }
    }

    finalScouts.sort((a, b) => a.name.localeCompare(b.name));
    const badgesList = CANON_BADGES.map(name => ({
      name, category: badgeIndex[name].category,
      required_group: badgeIndex[name].required_group, scouts: badgeIndex[name].scouts,
    }));

    const exportDate = exportDates.length ? exportDates.sort().slice(-1)[0] : new Date().toISOString().slice(0, 10);
    const uniqTroops = [...new Set(troopLabels.map(t => t[0]))].sort((a, b) => a - b);
    const troopLabel = "Troop " + uniqTroops.join(" & ");
    const uniqPairs = [...new Map(troopLabels.map(t => [t.join("|"), t])).values()].sort((a, b) => a[0] - b[0]);
    const noteParts = uniqPairs.map(([t, g]) => `Troop ${t} ${(g || "").toUpperCase()}`).join(" + ");
    let genDisplay = exportDate;
    if (exportDate.includes("-")) {
      const [y, mo, d] = exportDate.split("-");
      genDisplay = `${mo}/${d}/${y}`;
    }

    return {
      export_date: exportDate,
      export_note: `Built from Scoutbook's Merit Badge In-Progress Report (${noteParts}), generated ${genDisplay}`,
      troop_label: troopLabel,
      required_fixed: REQUIRED_FIXED,
      alt_groups: ALT_GROUPS,
      scouts: finalScouts,
      badges: badgesList,
    };
  }

  const api = { build, canonBadgeName, CANON_BADGES, REQUIRED_FIXED, ALT_GROUPS };
  global.TrackerParser = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
