const DISCORD = {
  // Buraya reyliar'in Discord User ID'sini yaz: Ornek: "123456789012345678"
  // Kullanici Lanyard sunucusunda yoksa API presence dondurmez ve fallback gosterilir.
  userId: new URLSearchParams(window.location.search).get("discordId")
    || document.documentElement.dataset.discordUserId
    || "",
  officialEndpoint: document.documentElement.dataset.discordApiEndpoint || "",
  fallbackBio: "its reyli! | TR | editor",
  fallbackBadge: "AEP",
  refreshMs: 30_000,
};

const LANYARD_BASE = "https://api.lanyard.rest/v1/users";
const CDN_BASE = "https://cdn.discordapp.com";

const selectors = {
  title: "#profile-title",
  bio: "#profile-bio",
  profileAvatar: "#profile-avatar",
  activityAvatar: "#activity-avatar",
  profileDecoration: "#profile-decoration",
  activityDecoration: "#activity-decoration",
  favicon: "#site-icon",
  name: "#discord-name",
  badge: "#profile-badge",
  badgeIcon: "#guild-badge-icon",
  badgeText: "#guild-badge-text",
  verb: "#activity-verb",
  activityTitle: "#activity-title",
  state: "#activity-state",
  statusDot: "#status-dot",
};

const el = Object.fromEntries(
  Object.entries(selectors).map(([key, selector]) => [key, document.querySelector(selector)])
);

const statusText = {
  online: "Online",
  idle: "Idling",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

const activityVerbs = {
  0: "Playing",
  1: "Streaming",
  2: "Listening to",
  3: "Watching",
  5: "Competing in",
};

function setText(node, value) {
  if (node && value) node.textContent = value;
}

function validDiscordId(value) {
  return /^\d{17,20}$/.test(value || "");
}

function avatarUrl(user, size = 256) {
  if (!user?.id || !user?.avatar) return "assets/avatar.svg";
  const ext = user.avatar.startsWith("a_") ? "gif" : "png";
  return `${CDN_BASE}/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
}

function decorationUrl(user, size = 240) {
  const asset = user?.avatar_decoration_data?.asset;
  if (!asset) return "";
  return `${CDN_BASE}/avatar-decoration-presets/${asset}.png?size=${size}&passthrough=false`;
}

function getPrimaryGuild(user) {
  const source = user?.primary_guild || user?.clan;
  if (!source) return null;

  const tag = source.tag;
  const identityEnabled = source.identity_enabled ?? source.identityEnabled;
  if (!tag || identityEnabled === false) return null;

  return {
    tag,
    guildId: source.identity_guild_id || source.identityGuildId || source.id,
    badge: source.badge || source.badge_hash || source.badgeHash,
  };
}

function guildTagBadgeUrl(guild, size = 64) {
  if (!guild?.guildId || !guild?.badge) return "";
  return `${CDN_BASE}/guild-tag-badges/${guild.guildId}/${guild.badge}.webp?size=${size}`;
}

function pickActivity(data) {
  if (data.spotify) {
    return {
      verb: "Listening to",
      name: data.spotify.song,
      state: data.spotify.artist,
    };
  }

  const activities = data.activities || [];
  const richActivity = activities.find((activity) => activity.type !== 4 && activity.name !== "Spotify");
  if (richActivity) {
    return {
      verb: activityVerbs[richActivity.type] || "Doing",
      name: richActivity.name,
      state: richActivity.details || richActivity.state || statusText[data.discord_status] || "Online",
    };
  }

  const customStatus = activities.find((activity) => activity.type === 4);
  if (customStatus) {
    return {
      verb: "Status",
      name: customStatus.state || customStatus.name,
      state: statusText[data.discord_status] || "Online",
    };
  }

  return {
    verb: "Status",
    name: statusText[data.discord_status] || "Offline",
    state: "No active activity",
  };
}

function updateDecoration(user) {
  const url = decorationUrl(user);
  for (const node of [el.profileDecoration, el.activityDecoration]) {
    if (!node) continue;
    if (!url) {
      node.hidden = true;
      node.removeAttribute("src");
      continue;
    }
    node.src = url;
    node.hidden = false;
  }
}

function updateFavicon(url) {
  if (!el.favicon || !url) return;
  el.favicon.href = url;
  el.favicon.type = url.includes(".gif") ? "image/gif" : "image/png";
}

function updateStatus(status) {
  if (!el.statusDot) return;
  el.statusDot.className = `status-dot status-dot--${status || "offline"}`;
}

function updateGuildTag(user, kv) {
  if (!el.badge || !el.badgeText) return;

  const guild = getPrimaryGuild(user);
  const fallbackTag = kv?.badge || DISCORD.fallbackBadge;
  const tag = guild?.tag || fallbackTag;
  const icon = guildTagBadgeUrl(guild);

  el.badge.hidden = !tag;
  setText(el.badgeText, tag);

  if (!el.badgeIcon) return;
  if (!icon) {
    el.badgeIcon.hidden = true;
    el.badgeIcon.removeAttribute("src");
    return;
  }

  el.badgeIcon.src = icon;
  el.badgeIcon.hidden = false;
}

function updateUserIdentity(user, kv = {}) {
  if (!user) return;

  const displayName = user.display_name || user.global_name || user.username || "reyliar";
  const bio = kv?.bio || kv?.about || DISCORD.fallbackBio;
  const avatar = avatarUrl(user);

  setText(el.title, displayName);
  setText(el.bio, bio);

  if (el.name) {
    el.name.firstChild.textContent = `${displayName}`;
  }

  updateGuildTag(user, kv);

  for (const node of [el.profileAvatar, el.activityAvatar]) {
    if (!node) continue;
    node.src = avatar;
    node.alt = `${displayName} Discord profil fotografi`;
  }

  updateDecoration(user);
  updateFavicon(avatarUrl(user, 128));
}

function updatePresence(data) {
  const currentActivity = pickActivity(data);

  setText(el.verb, currentActivity.verb);
  setText(el.activityTitle, currentActivity.name);
  setText(el.state, currentActivity.state);
  updateStatus(data.discord_status);
}

async function loadOfficialUser() {
  if (!validDiscordId(DISCORD.userId) || !DISCORD.officialEndpoint) return false;

  try {
    const url = new URL(DISCORD.officialEndpoint, window.location.origin);
    url.searchParams.set("userId", DISCORD.userId);

    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok || !payload.success || !payload.user) {
      throw new Error("Official Discord profile response failed");
    }

    updateUserIdentity(payload.user, payload.kv);
    return true;
  } catch (error) {
    console.warn("Official Discord profile could not be loaded:", error);
    return false;
  }
}

async function loadDiscordProfile() {
  if (!validDiscordId(DISCORD.userId)) return;

  const officialLoaded = await loadOfficialUser();

  try {
    const response = await fetch(`${LANYARD_BASE}/${DISCORD.userId}`, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error("Lanyard profile response failed");
    }

    if (!officialLoaded) updateUserIdentity(payload.data.discord_user, payload.data.kv);
    updatePresence(payload.data);
  } catch (error) {
    console.warn("Discord presence could not be loaded:", error);
  }
}

loadDiscordProfile();
setInterval(loadDiscordProfile, DISCORD.refreshMs);
