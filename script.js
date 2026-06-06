const DISCORD = {
  userId: new URLSearchParams(window.location.search).get("discordId")
    || document.documentElement.dataset.discordUserId
    || "",
  officialEndpoint: document.documentElement.dataset.discordApiEndpoint || "",
  viewsEndpoint: document.documentElement.dataset.viewsEndpoint || "",
  refreshMs: 30_000,
};

const LANYARD_BASE = "https://api.lanyard.rest/v1/users";
const CDN_BASE = "https://cdn.discordapp.com";

const selectors = {
  title: "#profile-title",
  bio: "#profile-bio",
  activityAvatar: "#activity-avatar",
  activityDecoration: "#activity-decoration",
  displayName: "#discord-display-name",
  badge: "#profile-badge",
  badgeIcon: "#guild-badge-icon",
  badgeText: "#guild-badge-text",
  verb: "#activity-verb",
  activityTitle: "#activity-title",
  state: "#activity-state",
  statusDot: "#status-dot",
  activityIcon: "#activity-icon",
  viewCount: "#view-count",
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

const wellKnownActivityIcons = {
  roblox: "https://cdn.discordapp.com/app-icons/363445589247131668/ef239176cd01d1c2bb7d1418b7a9b37f.png?size=128",
  spotify: "https://cdn.discordapp.com/embed/avatars/0.png",
};

function setText(node, value) {
  if (node) node.textContent = value || "";
}

function validDiscordId(value) {
  return /^\d{17,20}$/.test(value || "");
}

function cdnExt(hash, fallback = "png") {
  return hash?.startsWith("a_") ? "gif" : fallback;
}

function avatarUrl(user, size = 256) {
  if (!user?.id || !user?.avatar) return "assets/avatar.svg";
  return `${CDN_BASE}/avatars/${user.id}/${user.avatar}.${cdnExt(user.avatar)}?size=${size}`;
}

function decorationUrl(user, size = 240) {
  const asset = user?.avatar_decoration_data?.asset;
  if (!asset) return "";
  return `${CDN_BASE}/avatar-decoration-presets/${asset}.png?size=${size}&passthrough=true`;
}

function applicationAssetUrl(activity, asset, size = 128) {
  if (!activity?.application_id || !asset) return "";
  if (asset.startsWith("mp:")) return `https://media.discordapp.net/${asset.slice(3)}`;
  if (/^https?:\/\//i.test(asset)) return asset;
  return `${CDN_BASE}/app-assets/${activity.application_id}/${asset}.png?size=${size}`;
}

function applicationIconUrl(activity, size = 128) {
  const key = activity?.name?.toLowerCase();
  if (key && wellKnownActivityIcons[key]) return wellKnownActivityIcons[key];
  return applicationAssetUrl(activity, activity?.assets?.large_image || activity?.assets?.small_image, size);
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

function publicBio(user, kv = {}) {
  return user?.bio || user?.about_me || user?.about || kv?.bio || kv?.about || "";
}

function pickActivity(data = {}) {
  if (data.spotify) {
    return {
      verb: "Listening to",
      name: data.spotify.song,
      state: data.spotify.artist,
      icon: data.spotify.album_art_url || wellKnownActivityIcons.spotify,
    };
  }

  const activities = data.activities || [];
  const richActivity = activities.find((activity) => activity.type !== 4 && activity.name !== "Spotify");
  if (richActivity) {
    return {
      verb: activityVerbs[richActivity.type] || "Doing",
      name: richActivity.name,
      state: richActivity.details || richActivity.state || statusText[data.discord_status] || "Online",
      icon: applicationIconUrl(richActivity),
    };
  }

  const customStatus = activities.find((activity) => activity.type === 4);
  if (customStatus) {
    return {
      verb: "Status",
      name: customStatus.state || customStatus.name || statusText[data.discord_status] || "Online",
      state: statusText[data.discord_status] || "Online",
      icon: "",
    };
  }

  return {
    verb: "Status",
    name: statusText[data.discord_status] || "Offline",
    state: "No active activity",
    icon: "",
  };
}

function updateDecoration(user) {
  const url = decorationUrl(user);
  if (!el.activityDecoration) return;

  if (!url) {
    el.activityDecoration.hidden = true;
    el.activityDecoration.removeAttribute("src");
    return;
  }

  el.activityDecoration.src = url;
  el.activityDecoration.hidden = false;
}

function updateStatus(status) {
  if (!el.statusDot) return;
  el.statusDot.className = `status-dot status-dot--${status || "offline"}`;
}

function updateGuildTag(user) {
  if (!el.badge || !el.badgeText) return;

  const guild = getPrimaryGuild(user);
  el.badge.hidden = !guild?.tag;
  setText(el.badgeText, guild?.tag || "");

  if (!el.badgeIcon) return;
  const icon = guildTagBadgeUrl(guild);
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
  const bio = publicBio(user, kv);
  const avatar = avatarUrl(user);

  setText(el.title, displayName);
  setText(el.displayName, displayName);

  if (bio) {
    setText(el.bio, bio);
    el.bio.hidden = false;
  } else if (el.bio) {
    setText(el.bio, "");
    el.bio.hidden = true;
  }

  updateGuildTag(user);

  if (el.activityAvatar) {
    el.activityAvatar.src = avatar;
    el.activityAvatar.alt = `${displayName} Discord profil fotografi`;
  }

  updateDecoration(user);
}

function updateActivityIcon(icon) {
  if (!el.activityIcon) return;

  if (!icon) {
    el.activityIcon.hidden = true;
    el.activityIcon.removeAttribute("src");
    return;
  }

  el.activityIcon.src = icon;
  el.activityIcon.hidden = false;
}

function updatePresence(data = {}) {
  const currentActivity = pickActivity(data);

  setText(el.verb, currentActivity.verb);
  setText(el.activityTitle, currentActivity.name);
  setText(el.state, currentActivity.state);
  updateActivityIcon(currentActivity.icon);
  updateStatus(data.discord_status || data.status || "offline");
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
    if (payload.presence) updatePresence(payload.presence);
    return true;
  } catch (error) {
    console.warn("Official Discord profile could not be loaded:", error);
    return false;
  }
}

async function loadLanyardPresence(allowIdentityFallback) {
  try {
    const response = await fetch(`${LANYARD_BASE}/${DISCORD.userId}`, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error("Lanyard presence response failed");
    }

    if (allowIdentityFallback) updateUserIdentity(payload.data.discord_user, payload.data.kv);
    updatePresence(payload.data);
  } catch (error) {
    console.warn("Live Discord presence could not be loaded:", error);
    updatePresence({ discord_status: "offline", activities: [] });
  }
}

async function loadDiscordProfile() {
  if (!validDiscordId(DISCORD.userId)) return;

  const officialLoaded = await loadOfficialUser();
  await loadLanyardPresence(!officialLoaded);
}

async function loadViewCount() {
  if (!DISCORD.viewsEndpoint || !el.viewCount) return;

  try {
    const response = await fetch(DISCORD.viewsEndpoint, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error("View counter response failed");
    }

    setText(el.viewCount, new Intl.NumberFormat("tr-TR").format(payload.count || 0));
  } catch (error) {
    console.warn("View count could not be loaded:", error);
    setText(el.viewCount, "0");
  }
}

loadDiscordProfile();
loadViewCount();
setInterval(loadDiscordProfile, DISCORD.refreshMs);
