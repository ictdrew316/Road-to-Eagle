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

  function fmtISODate(iso) {
    if (!iso || !iso.includes("-")) return iso || "unknown date";
    const [y, mo, d] = iso.split("-");
    return `${mo}/${d}/${y}`;
  }

  // ---- per-scout helpers (shared by build() and the merge's carry-forward) ----
  function finalizeRec(rec) {
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

  // rec: {member_id, name, troop, rank, approved{}, awaiting[], in_progress[], elective_earned[]}
  function deriveScout(rec) {
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
    return {
      member_id: parseInt(rec.member_id, 10),
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
    };
  }

  // [badgeName, badge-index entry] pairs for one scout
  function indexEntries(rec) {
    const out = [];
    for (const badge in rec.approved) {
      out.push([badge, { name: rec.name, troop: rec.troop, status: "earned", date: rec.approved[badge].date, mbc: rec.approved[badge].mbc }]);
    }
    for (const a of rec.awaiting) {
      out.push([a.badge, { name: rec.name, troop: rec.troop, status: "ready", stage: a.stage, mbc: a.mbc }]);
    }
    for (const p of rec.in_progress) {
      out.push([p.badge, { name: rec.name, troop: rec.troop, status: "progress", remaining: p.remaining, mbc: p.mbc }]);
    }
    return out;
  }

  function build(files) {
    // files: [{name, text}]
    const scouts = new Map(); // member_id -> record
    const exportDates = [];
    const troopMeta = []; // [{num, gender, genDate}] -- one per uploaded file

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
      troopMeta.push({ num: troopNum, gender: troopGender, genDate });
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
    for (const rec of scouts.values()) finalizeRec(rec);

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
      finalScouts.push(deriveScout(rec));
      for (const [badge, entry] of indexEntries(rec)) {
        if (badgeIndex[badge]) badgeIndex[badge].scouts.push(entry);
      }
    }

    finalScouts.sort((a, b) => a.name.localeCompare(b.name));
    const badgesList = CANON_BADGES.map(name => ({
      name, category: badgeIndex[name].category,
      required_group: badgeIndex[name].required_group, scouts: badgeIndex[name].scouts,
    }));

    const exportDate = exportDates.length ? exportDates.sort().slice(-1)[0] : new Date().toISOString().slice(0, 10);
    const uniqTroopMeta = [...new Map(troopMeta.map(t => [t.num, t])).values()].sort((a, b) => a.num - b.num);
    const troopLabel = "Troop " + uniqTroopMeta.map(t => t.num).join(" & ");
    const noteParts = uniqTroopMeta
      .map(t => `Troop ${t.num}${t.gender ? " " + t.gender.toUpperCase() : ""} generated ${fmtISODate(t.genDate)}`)
      .join(", ");

    return {
      export_date: exportDate,
      export_note: `Built from Scoutbook's Merit Badge In-Progress Report — ${noteParts}`,
      troop_label: troopLabel,
      required_fixed: REQUIRED_FIXED,
      alt_groups: ALT_GROUPS,
      troops: uniqTroopMeta,
      scouts: finalScouts,
      badges: badgesList,
    };
  }

  // Merge a freshly-parsed upload into the currently-published data at the
  // individual-SCOUT level (keyed by Scoutbook member ID):
  //   - a scout who appears in the upload gets their record refreshed from it
  //   - a scout who does NOT appear in the upload is kept exactly as published
  //   - nobody is ever removed by an upload
  // So uploading a whole troop, both troops, or a single scout's report all
  // behave the same way -- only the scouts in the file(s) change.
  function deriveTroopMeta(data) {
    if (Array.isArray(data.troops) && data.troops.length) return data.troops;
    // Older published data (from before per-troop metadata existed) --
    // reconstruct as best we can so merging still works.
    const nums = [...new Set(data.scouts.map(s => s.troop))].sort((a, b) => a - b);
    return nums.map(num => ({ num, gender: null, genDate: data.export_date || null }));
  }

  // ---- "never drop anything" rule ------------------------------------------
  // Scoutbook reports are snapshots and don't always contain everything (e.g. a
  // report with no "Approved or Awarded" section). So when a scout in an upload
  // already has a published record, we fold the old record in:
  //   - earned (approved/awarded) badges: union of what was published and what
  //     the upload shows -- earned badges can only be added, never removed
  //   - in-progress / awaiting sign-off: the upload's snapshot wins; an entry
  //     that was published but is missing from the upload is carried forward
  //     unless that badge is now earned or appears in the upload another way
  //   - rank: whichever is higher
  const RANK_ORDER = ["", "Scout", "Tenderfoot", "Second Class", "First Class", "Star", "Life", "Eagle"];
  function rankIdx(r) { const i = RANK_ORDER.indexOf((r || "").trim()); return i < 0 ? 0 : i; }

  function approvedFrom(scout, badges) {
    const approved = {};
    // from the scout's own record (dates only) ...
    for (const it of scout.required_checklist || []) {
      if (it.type === "single") { if (it.done) approved[it.badge] = { date: it.date || null, mbc: "" }; }
      else for (const o of (it.earned_options || (it.earned ? [it.earned] : []))) {
        approved[o] = { date: (o === it.earned ? it.date : null) || null, mbc: "" };
      }
    }
    for (const e of scout.elective_earned || []) approved[e.badge] = { date: e.date || null, mbc: "" };
    // ... then overlay the badge index (carries counselor + the exact date)
    for (const b of badges || []) {
      for (const sc of b.scouts || []) {
        if (sc.status === "earned" && sc.name === scout.name && sc.troop === scout.troop) {
          approved[b.name] = { date: sc.date || (approved[b.name] && approved[b.name].date) || null, mbc: sc.mbc || "" };
        }
      }
    }
    return approved;
  }

  // The published record for a scout in an upload: same Scoutbook member ID, or --
  // when Scoutbook has issued a scout a NEW member ID (it happens) -- the published
  // record with the same name + troop that no scout in the upload is using by ID.
  function matchPublished(oldData, ns, uploadIds) {
    const byId = oldData.scouts.find(s => s.member_id === ns.member_id);
    if (byId) return byId;
    const ids = uploadIds || new Set();
    return oldData.scouts.find(s => s.name === ns.name && s.troop === ns.troop && !ids.has(s.member_id)) || null;
  }

  function carryForward(newData, oldData) {
    const uploadIds = new Set(newData.scouts.map(s => s.member_id));
    const aliased = new Set(); // published member IDs superseded by a new ID for the same scout
    const rebuilt = new Map(); // member_id -> {scout, entries:[[badge, entry]]}
    for (const ns of newData.scouts) {
      const os = matchPublished(oldData, ns, uploadIds);
      if (!os) continue;
      if (os.member_id !== ns.member_id) aliased.add(os.member_id);
      const approved = approvedFrom(os, oldData.badges);
      const fresh = approvedFrom(ns, newData.badges);
      for (const b in fresh) {
        approved[b] = { date: fresh[b].date || (approved[b] && approved[b].date) || null, mbc: fresh[b].mbc || (approved[b] && approved[b].mbc) || "" };
      }
      const nip = new Set(ns.in_progress.map(x => x.badge));
      const naw = new Set(ns.awaiting_signoff.map(x => x.badge));
      const keep = x => !(x.badge in approved) && !nip.has(x.badge) && !naw.has(x.badge);
      const rec = {
        member_id: ns.member_id,
        name: ns.name,
        troop: ns.troop,
        rank: rankIdx(os.rank) > rankIdx(ns.rank) ? os.rank : ns.rank,
        approved,
        awaiting: ns.awaiting_signoff.filter(x => !(x.badge in approved)).concat((os.awaiting_signoff || []).filter(keep)),
        in_progress: ns.in_progress.concat((os.in_progress || []).filter(keep)),
        elective_earned: [],
      };
      finalizeRec(rec);
      rebuilt.set(ns.member_id, { scout: deriveScout(rec), entries: indexEntries(rec) });
    }
    if (!rebuilt.size) return { data: newData, aliased };
    const byKey = new Map(newData.scouts.filter(s => rebuilt.has(s.member_id)).map(s => [`${s.name}|${s.troop}`, s.member_id]));
    const extra = new Map(); // badge -> [entries]
    for (const { entries } of rebuilt.values()) {
      for (const [badge, entry] of entries) {
        if (!extra.has(badge)) extra.set(badge, []);
        extra.get(badge).push(entry);
      }
    }
    return {
      aliased,
      data: {
        ...newData,
        scouts: newData.scouts.map(s => rebuilt.has(s.member_id) ? rebuilt.get(s.member_id).scout : s),
        badges: newData.badges.map(b => ({
          ...b,
          scouts: (b.scouts || []).filter(sc => !byKey.has(`${sc.name}|${sc.troop}`)).concat(extra.get(b.name) || []),
        })),
      },
    };
  }

  function mergeUpdate(newData, oldData, opts) {
    if (!oldData) return newData;
    const key = (name, troop) => `${name}|${troop}`;

    // Scouts to leave exactly as published: ones the admin held back in the
    // review step, plus any scout an admin previously removed (their member ID
    // is on the "removed" list so a re-upload doesn't bring them back).
    const dropIds = new Set((opts && opts.skipIds) || []);
    for (const r of (oldData.removed || [])) dropIds.add(r.member_id);
    if (dropIds.size) {
      const dropKeys = new Set(newData.scouts.filter(s => dropIds.has(s.member_id)).map(s => key(s.name, s.troop)));
      const usable = newData.scouts.filter(s => !dropIds.has(s.member_id));
      const troopsInUse = new Set(usable.map(s => s.troop));
      newData = {
        ...newData,
        scouts: usable,
        badges: newData.badges.map(b => ({ ...b, scouts: (b.scouts || []).filter(sc => !dropKeys.has(key(sc.name, sc.troop))) })),
        troops: (newData.troops || []).filter(t => troopsInUse.has(t.num)),
      };
    }

    // earned badges (and the other rules above) carry forward from the published record
    const cf = carryForward(newData, oldData);
    newData = cf.data;

    const newIds = new Set(newData.scouts.map(s => s.member_id));

    // badge-index entries carry name+troop (not member_id), so work out which
    // entries belong to scouts being refreshed (match old records by member_id,
    // so a name change in Scoutbook still replaces the right entries).
    const replacedKeys = new Set(newData.scouts.map(s => key(s.name, s.troop)));
    for (const s of oldData.scouts) if (newIds.has(s.member_id) || cf.aliased.has(s.member_id)) replacedKeys.add(key(s.name, s.troop));

    const keptScouts = oldData.scouts.filter(s => !newIds.has(s.member_id) && !cf.aliased.has(s.member_id));
    const mergedScouts = keptScouts.concat(newData.scouts).sort((a, b) => a.name.localeCompare(b.name));

    const newBadgeByName = new Map(newData.badges.map(b => [b.name, b]));
    const mergedBadges = oldData.badges.map(ob => {
      const nb = newBadgeByName.get(ob.name);
      const keptEntries = (ob.scouts || []).filter(sc => !replacedKeys.has(key(sc.name, sc.troop)));
      const newEntries = nb ? nb.scouts : [];
      return {
        name: ob.name,
        category: nb ? nb.category : ob.category,
        required_group: nb ? nb.required_group : ob.required_group,
        scouts: keptEntries.concat(newEntries),
      };
    });

    // per-troop "last updated" date: newest of what was published and what's in this upload
    const metaByNum = new Map(deriveTroopMeta(oldData).map(t => [t.num, { ...t }]));
    for (const t of (newData.troops || [])) {
      const prev = metaByNum.get(t.num);
      if (!prev) { metaByNum.set(t.num, { ...t }); continue; }
      const newest = [prev.genDate, t.genDate].filter(Boolean).sort().slice(-1)[0] || null;
      metaByNum.set(t.num, { num: t.num, gender: t.gender || prev.gender || null, genDate: newest });
    }
    const mergedTroopMeta = [...metaByNum.values()].sort((a, b) => a.num - b.num);

    const noteParts = mergedTroopMeta
      .map(t => `Troop ${t.num}${t.gender ? " " + t.gender.toUpperCase() : ""} updated ${fmtISODate(t.genDate)}`)
      .join(", ");
    const exportDate = mergedTroopMeta.map(t => t.genDate).filter(Boolean).sort().slice(-1)[0] || newData.export_date;

    return {
      export_date: exportDate,
      export_note: `Built from Scoutbook's Merit Badge In-Progress Report — ${noteParts}`,
      troop_label: "Troop " + mergedTroopMeta.map(t => t.num).join(" & "),
      required_fixed: newData.required_fixed,
      alt_groups: newData.alt_groups,
      troops: mergedTroopMeta,
      removed: oldData.removed || [],
      scouts: mergedScouts,
      badges: mergedBadges,
    };
  }

  // ---- review-step helpers ----
  function earnedSet(sc) {
    const set = new Set();
    for (const it of sc.required_checklist || []) {
      if (it.type === "single") { if (it.done) set.add(it.badge); }
      else for (const o of (it.earned_options || (it.earned ? [it.earned] : []))) set.add(o);
    }
    for (const e of sc.elective_earned || []) set.add(e.badge);
    return set;
  }
  function listShort(arr, n) {
    return arr.length > n ? arr.slice(0, n).join(", ") + ` +${arr.length - n} more` : arr.join(", ");
  }

  // Describe what an upload would change for one scout (os = currently published record).
  function diffScout(ns, os) {
    if (!os) return { changed: true, risky: false, tags: [{ kind: "new", label: "new scout" }] };
    if (JSON.stringify(ns) === JSON.stringify(os)) return { changed: false, risky: false, tags: [] };
    const tags = [];
    let risky = false;
    const oe = earnedSet(os), ne = earnedSet(ns);
    const added = [...ne].filter(b => !oe.has(b)).sort();
    const lost = [...oe].filter(b => !ne.has(b)).sort();
    if (added.length) tags.push({ kind: "up", label: "earned: " + listShort(added, 4) });
    if (lost.length) { risky = true; tags.push({ kind: "gone", label: "missing earned badge(s): " + listShort(lost, 4) }); }
    if (ns.eagle_ready && !os.eagle_ready) tags.push({ kind: "eagle", label: "now Eagle ready" });
    if (!ns.eagle_ready && os.eagle_ready) { risky = true; tags.push({ kind: "gone", label: "no longer Eagle ready" }); }
    if ((ns.rank || "") !== (os.rank || "")) tags.push({ kind: "info", label: `rank ${os.rank || "none"} → ${ns.rank || "none"}` });
    const ip = x => new Set((x.in_progress || []).map(b => b.badge));
    const nip = ip(ns), oip = ip(os);
    const ipAdd = [...nip].filter(b => !oip.has(b)).length, ipDel = [...oip].filter(b => !nip.has(b)).length;
    if (ipAdd || ipDel) tags.push({ kind: "info", label: `in progress +${ipAdd} / −${ipDel}` });
    const aw = x => new Set((x.awaiting_signoff || []).map(b => b.badge + "|" + b.stage));
    const naw = aw(ns), oaw = aw(os);
    const awAdd = [...naw].filter(b => !oaw.has(b)).length, awDel = [...oaw].filter(b => !naw.has(b)).length;
    if (awAdd || awDel) tags.push({ kind: "info", label: `awaiting sign-off +${awAdd} / −${awDel}` });
    if (!tags.length) tags.push({ kind: "info", label: "requirement details updated" });
    return { changed: true, risky, tags };
  }

  // Remove scouts from the published data. Only the Scoutbook member ID is kept
  // (no names) so a re-upload doesn't resurrect them.
  function removeScouts(data, ids, whenISO) {
    const idSet = new Set(ids);
    const gone = data.scouts.filter(s => idSet.has(s.member_id));
    const keys = new Set(gone.map(s => `${s.name}|${s.troop}`));
    const removed = (data.removed || []).filter(r => !idSet.has(r.member_id))
      .concat(gone.map(s => ({ member_id: s.member_id, removed_on: whenISO })));
    return {
      ...data,
      scouts: data.scouts.filter(s => !idSet.has(s.member_id)),
      badges: data.badges.map(b => ({ ...b, scouts: (b.scouts || []).filter(sc => !keys.has(`${sc.name}|${sc.troop}`)) })),
      removed,
    };
  }
  function restoreScouts(data, ids) {
    const idSet = new Set(ids);
    return { ...data, removed: (data.removed || []).filter(r => !idSet.has(r.member_id)) };
  }

  const api = { build, mergeUpdate, matchPublished, diffScout, removeScouts, restoreScouts, canonBadgeName, CANON_BADGES, REQUIRED_FIXED, ALT_GROUPS };
  global.TrackerParser = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
