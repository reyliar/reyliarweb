const DISCORD = {
  userId: new URLSearchParams(window.location.search).get("discordId")
    || document.documentElement.dataset.discordUserId
    || "",
  officialEndpoint: document.documentElement.dataset.discordApiEndpoint || "",
  viewsEndpoint: document.documentElement.dataset.viewsEndpoint || "",
  refreshMs: 1_000,
};

const LANYARD_BASE = "https://api.lanyard.rest/v1/users";
const CDN_BASE = "https://cdn.discordapp.com";
const YOUTUBE_API_SRC = "https://www.youtube.com/iframe_api";

const MUSIC = {
  defaultVolume: 55,
  progressMs: 500,
  playlist: [
    {
      videoId: "LHLumo6sDG4",
      title: "ice - super slowed",
      artist: "ZERTAL - Topic",
      thumbnail: "https://i.ytimg.com/vi/LHLumo6sDG4/hqdefault.jpg",
    },
    {
      videoId: "RTUr_ZD0niQ",
      title: "esdeekid - mist // slowed & reverb",
      artist: "lilreverbgod.",
      thumbnail: "https://i.ytimg.com/vi/RTUr_ZD0niQ/hqdefault.jpg",
    },
    {
      videoId: "eMOKD-RUfIg",
      title: "pinkpantheress - pain (slowed + reverb)",
      artist: "koreancofee",
      thumbnail: "https://i.ytimg.com/vi/eMOKD-RUfIg/hqdefault.jpg",
    },
    {
      videoId: "ZGSl0qBifII",
      title: "cult member - u weren't here i really miss you (slowed x reverb)",
      artist: "lusheyenne",
      thumbnail: "https://i.ytimg.com/vi/ZGSl0qBifII/hqdefault.jpg",
    },
    {
      videoId: "76kMS0DzXIQ",
      title: "ECSTACY (SLOWED + REVERB)",
      artist: "Aerimuse",
      thumbnail: "https://i.ytimg.com/vi/76kMS0DzXIQ/hqdefault.jpg",
    },
  ],
};

const selectors = {
  enterScreen: "#enter-screen",
  enterButton: "#enter-button",
  activity: ".activity",
  title: "#profile-title",
  bio: "#profile-bio",
  activityAvatar: "#activity-avatar",
  activityDevice: ".activity-device",
  profileDecoration: "#profile-decoration",
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
  musicPlayer: "#music-player-card",
  youtubePlayer: "#youtube-player",
  musicCover: "#music-cover",
  musicTitle: "#music-title",
  musicArtist: "#music-artist",
  musicToggle: "#music-toggle",
  musicNext: "#music-next",
  musicMute: "#music-mute",
  musicVolume: "#music-volume",
  musicProgress: "#music-progress",
  musicCurrent: "#music-current",
  musicDuration: "#music-duration",
  musicState: "#music-state",
};

const el = Object.fromEntries(
  Object.entries(selectors).map(([key, selector]) => [key, document.querySelector(selector)])
);

let hasLivePresence = false;
let discordProfileRequest = null;
let youtubePlayer = null;
let youtubeReady = false;
let youtubeApiLoading = false;
let musicWantsPlay = false;
let musicSeeking = false;
let musicProgressTimer = null;
let lastMusicVolume = MUSIC.defaultVolume;
let musicIndex = 0;

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

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`;
  }

  return `${minutes}:${remainder}`;
}

function currentTrack() {
  return MUSIC.playlist[musicIndex] || MUSIC.playlist[0];
}

function normalizeTrackIndex(index) {
  const total = MUSIC.playlist.length;
  if (total <= 0) return 0;
  return ((index % total) + total) % total;
}

function resetMusicProgress() {
  if (el.musicProgress) el.musicProgress.value = "0";
  setText(el.musicCurrent, "0:00");
  setText(el.musicDuration, "0:00");
}

function updateMusicTrackUi() {
  const track = currentTrack();
  if (!track) return;

  setText(el.musicTitle, track.title);
  setText(el.musicArtist, track.artist);

  if (el.musicCover && el.musicCover.src !== track.thumbnail) {
    el.musicCover.src = track.thumbnail;
  }
}

function setMusicStatus(status) {
  if (!el.musicPlayer) return;

  el.musicPlayer.classList.toggle("is-loading", status === "loading");
  el.musicPlayer.classList.toggle("is-playing", status === "playing");
  el.musicPlayer.classList.toggle("is-error", status === "error");
  setText(el.musicState, status);

  if (el.musicToggle) {
    el.musicToggle.setAttribute("aria-label", status === "playing" ? "Pause" : "Play");
  }
}

function getMusicValue(method) {
  try {
    const value = youtubePlayer?.[method]?.();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function updateMusicProgress() {
  if (!youtubeReady || !youtubePlayer) return;

  const duration = getMusicValue("getDuration");
  const current = getMusicValue("getCurrentTime");
  setText(el.musicCurrent, formatTime(current));
  setText(el.musicDuration, formatTime(duration));

  if (el.musicProgress && duration > 0 && !musicSeeking) {
    const percent = Math.min(100, Math.max(0, (current / duration) * 100));
    el.musicProgress.value = percent.toFixed(1);
  }
}

function startMusicProgressTimer() {
  if (musicProgressTimer) return;
  musicProgressTimer = window.setInterval(updateMusicProgress, MUSIC.progressMs);
}

function syncMusicMuted() {
  let muted = Number(el.musicVolume?.value || 0) <= 0;

  try {
    muted = muted || Boolean(youtubeReady && youtubePlayer?.isMuted?.());
  } catch {
    muted = true;
  }

  if (el.musicPlayer) el.musicPlayer.classList.toggle("is-muted", muted);
  if (el.musicMute) el.musicMute.setAttribute("aria-label", muted ? "Unmute" : "Mute");
}

function setMusicVolume(value) {
  const volume = clampNumber(value, 0, 100, MUSIC.defaultVolume);
  if (el.musicVolume) el.musicVolume.value = String(volume);
  if (volume > 0) lastMusicVolume = volume;

  try {
    youtubePlayer?.setVolume?.(volume);
    if (volume <= 0) {
      youtubePlayer?.mute?.();
    } else {
      youtubePlayer?.unMute?.();
    }
  } catch {
    setMusicStatus("error");
  }

  syncMusicMuted();
}

function setMusicMuted(muted) {
  if (muted) {
    lastMusicVolume = clampNumber(el.musicVolume?.value, 1, 100, lastMusicVolume);
    setMusicVolume(0);
    return;
  }

  setMusicVolume(lastMusicVolume || MUSIC.defaultVolume);
}

function onMusicReady(event) {
  youtubeReady = true;
  const volume = clampNumber(el.musicVolume?.value, 0, 100, MUSIC.defaultVolume);

  try {
    event.target.setVolume(volume);
    if (volume <= 0) event.target.mute();
  } catch {
    setMusicStatus("error");
    return;
  }

  startMusicProgressTimer();
  updateMusicTrackUi();
  updateMusicProgress();
  syncMusicMuted();
  setMusicStatus(musicWantsPlay ? "loading" : "ready");

  try {
    if (musicWantsPlay) {
      event.target.loadVideoById(currentTrack().videoId);
    } else {
      event.target.cueVideoById(currentTrack().videoId);
    }
  } catch {
    setMusicStatus("error");
  }
}

function onMusicStateChange(event) {
  const states = window.YT?.PlayerState || {};

  if (event.data === states.PLAYING) {
    setMusicStatus("playing");
  } else if (event.data === states.PAUSED) {
    setMusicStatus("paused");
  } else if (event.data === states.BUFFERING) {
    setMusicStatus("loading");
  } else if (event.data === states.ENDED && musicWantsPlay) {
    nextMusic(true);
  } else if (event.data === states.CUED && !musicWantsPlay) {
    setMusicStatus("ready");
  }

  updateMusicProgress();
  syncMusicMuted();
}

function onMusicError() {
  musicWantsPlay = false;
  setMusicStatus("error");
}

function createYoutubePlayer() {
  if (youtubePlayer || !el.youtubePlayer || !window.YT?.Player) return;

  const playerVars = {
    autoplay: 0,
    controls: 0,
    disablekb: 1,
    fs: 0,
    iv_load_policy: 3,
    playsinline: 1,
    rel: 0,
  };

  if (window.location.origin !== "null") {
    playerVars.origin = window.location.origin;
  }

  setMusicStatus("loading");
  youtubePlayer = new window.YT.Player(el.youtubePlayer, {
    width: 200,
    height: 200,
    videoId: currentTrack().videoId,
    playerVars,
    events: {
      onReady: onMusicReady,
      onStateChange: onMusicStateChange,
      onError: onMusicError,
    },
  });
}

function loadYouTubeApi() {
  if (!el.musicPlayer) return;

  if (window.YT?.Player) {
    createYoutubePlayer();
    return;
  }

  if (youtubeApiLoading) return;
  youtubeApiLoading = true;

  const previousReady = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    if (typeof previousReady === "function") previousReady();
    createYoutubePlayer();
  };

  const script = document.createElement("script");
  script.src = YOUTUBE_API_SRC;
  script.async = true;
  script.onerror = onMusicError;
  document.head.appendChild(script);
}

function playMusic() {
  musicWantsPlay = true;

  if (!youtubeReady || !youtubePlayer?.playVideo) {
    setMusicStatus("loading");
    loadYouTubeApi();
    return;
  }

  try {
    youtubePlayer.playVideo();
    setMusicStatus("loading");
  } catch {
    setMusicStatus("error");
  }
}

function pauseMusic() {
  musicWantsPlay = false;

  try {
    youtubePlayer?.pauseVideo?.();
  } catch {
    setMusicStatus("error");
    return;
  }

  setMusicStatus("paused");
}

function toggleMusic() {
  const states = window.YT?.PlayerState || {};
  const state = getMusicValue("getPlayerState");

  if (state === states.PLAYING || state === states.BUFFERING) {
    pauseMusic();
  } else {
    playMusic();
  }
}

function loadMusicTrack(index, autoplay = musicWantsPlay) {
  musicIndex = normalizeTrackIndex(index);
  musicWantsPlay = Boolean(autoplay);
  musicSeeking = false;
  updateMusicTrackUi();
  resetMusicProgress();

  if (!youtubeReady || !youtubePlayer) {
    setMusicStatus(autoplay ? "loading" : "ready");
    loadYouTubeApi();
    return;
  }

  const track = currentTrack();

  try {
    if (autoplay) {
      youtubePlayer.loadVideoById(track.videoId);
      setMusicStatus("loading");
    } else {
      youtubePlayer.cueVideoById(track.videoId);
      setMusicStatus("ready");
    }
  } catch {
    setMusicStatus("error");
  }
}

function nextMusic(forceAutoplay) {
  const states = window.YT?.PlayerState || {};
  const state = getMusicValue("getPlayerState");
  const shouldAutoplay = forceAutoplay ?? (musicWantsPlay || state === states.PLAYING || state === states.BUFFERING);
  loadMusicTrack(musicIndex + 1, shouldAutoplay);
}

function seekMusicFromProgress() {
  if (!youtubeReady || !youtubePlayer || !el.musicProgress) return;

  const duration = getMusicValue("getDuration");
  const percent = clampNumber(el.musicProgress.value, 0, 100, 0);
  const nextTime = duration * (percent / 100);

  try {
    youtubePlayer.seekTo(nextTime, true);
  } catch {
    setMusicStatus("error");
  }

  musicSeeking = false;
  updateMusicProgress();
}

function previewMusicProgress() {
  if (!youtubeReady || !el.musicProgress) return;

  musicSeeking = true;
  const duration = getMusicValue("getDuration");
  const percent = clampNumber(el.musicProgress.value, 0, 100, 0);
  setText(el.musicCurrent, formatTime(duration * (percent / 100)));
}

function enterSite() {
  document.body.classList.add("site-entered");

  if (el.enterScreen) {
    el.enterScreen.classList.add("is-hidden");
    window.setTimeout(() => {
      el.enterScreen.hidden = true;
    }, 560);
  }

  playMusic();
}

function initMusicPlayer() {
  if (!el.musicPlayer) return;

  updateMusicTrackUi();
  resetMusicProgress();
  setMusicVolume(el.musicVolume?.value || MUSIC.defaultVolume);
  setMusicStatus("ready");
  loadYouTubeApi();

  el.enterButton?.addEventListener("click", enterSite);
  el.musicToggle?.addEventListener("click", toggleMusic);
  el.musicNext?.addEventListener("click", () => nextMusic());
  el.musicMute?.addEventListener("click", () => {
    setMusicMuted(!el.musicPlayer.classList.contains("is-muted"));
  });
  el.musicVolume?.addEventListener("input", (event) => {
    setMusicVolume(event.target.value);
  });
  el.musicProgress?.addEventListener("input", previewMusicProgress);
  el.musicProgress?.addEventListener("change", seekMusicFromProgress);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function renderMarkdown(value) {
  let html = escapeHtml(String(value || "").trim());

  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s<]+)\)/g, (match, label, url) => {
    const href = safeHttpUrl(url.replace(/&amp;/g, "&"));
    if (!href) return label;
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  html = html
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\r?\n/g, "<br>");

  return html;
}

function setMarkdown(node, value) {
  if (node) node.innerHTML = renderMarkdown(value);
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
  return user?.bio
    || user?.profile?.bio
    || user?.about_me
    || user?.about
    || kv?.discord_bio
    || kv?.bio
    || kv?.about
    || "";
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
  if (!el.profileDecoration) return;

  if (!url) {
    if (el.profileDecoration.dataset.src === "") return;
    el.profileDecoration.dataset.src = "";
    el.profileDecoration.hidden = true;
    el.profileDecoration.removeAttribute("src");
    return;
  }

  if (el.profileDecoration.dataset.src === url) {
    el.profileDecoration.hidden = false;
    return;
  }

  el.profileDecoration.dataset.src = url;
  el.profileDecoration.src = url;
  el.profileDecoration.hidden = false;
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
    setMarkdown(el.bio, bio);
    el.bio.hidden = false;
  } else if (el.bio) {
    el.bio.innerHTML = "";
    el.bio.hidden = true;
  }

  updateGuildTag(user);

  if (el.activityAvatar) {
    el.activityAvatar.src = avatar;
    el.activityAvatar.alt = `${displayName} Discord profile photo`;
  }

  updateDecoration(user);
}

function updateActivityIcon(icon) {
  const setDeviceVisible = (visible) => {
    if (el.activityDevice) el.activityDevice.hidden = !visible;
    if (el.activity) el.activity.classList.toggle("activity--no-device", !visible);
  };

  if (!el.activityIcon) {
    setDeviceVisible(false);
    return;
  }

  if (!icon) {
    el.activityIcon.hidden = true;
    el.activityIcon.removeAttribute("src");
    setDeviceVisible(false);
    return;
  }

  el.activityIcon.onerror = () => {
    el.activityIcon.hidden = true;
    el.activityIcon.removeAttribute("src");
    setDeviceVisible(false);
  };
  setDeviceVisible(true);
  el.activityIcon.src = icon;
  el.activityIcon.hidden = false;
}

function clearPresenceUi() {
  setText(el.verb, "");
  setText(el.activityTitle, "");
  setText(el.state, "");
  updateActivityIcon("");
  updateStatus("offline");
}

function updatePresence(data = {}) {
  clearPresenceUi();
  const currentActivity = pickActivity(data);

  setText(el.verb, currentActivity.verb);
  setText(el.activityTitle, currentActivity.name);
  setText(el.state, currentActivity.state);
  updateActivityIcon(currentActivity.icon);
  updateStatus(data.discord_status || data.status || "offline");
  hasLivePresence = Boolean(data.discord_status || data.status || currentActivity.name);
}

async function loadOfficialUser() {
  if (!validDiscordId(DISCORD.userId) || !DISCORD.officialEndpoint) {
    return { identityLoaded: false, presenceLoaded: false };
  }

  try {
    const url = new URL(DISCORD.officialEndpoint, window.location.origin);
    url.searchParams.set("userId", DISCORD.userId);
    url.searchParams.set("fresh", String(Math.floor(Date.now() / DISCORD.refreshMs)));

    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok || !payload.success || !payload.user) {
      throw new Error("Official Discord profile response failed");
    }

    updateUserIdentity(payload.user, payload.kv);
    if (payload.presence) updatePresence(payload.presence);
    return { identityLoaded: true, presenceLoaded: Boolean(payload.presence) };
  } catch (error) {
    console.warn("Official Discord profile could not be loaded:", error);
    return { identityLoaded: false, presenceLoaded: false };
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
    if (!hasLivePresence) updatePresence({ discord_status: "offline", activities: [] });
  }
}

async function loadDiscordProfile() {
  if (!validDiscordId(DISCORD.userId)) return;
  if (discordProfileRequest) return discordProfileRequest;

  discordProfileRequest = (async () => {
    const official = await loadOfficialUser();
    if (!official.presenceLoaded) await loadLanyardPresence(!official.identityLoaded);
  })().finally(() => {
    discordProfileRequest = null;
  });

  return discordProfileRequest;
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

    setText(el.viewCount, new Intl.NumberFormat("en-US").format(payload.count || 0));
  } catch (error) {
    console.warn("View count could not be loaded:", error);
    setText(el.viewCount, "0");
  }
}

initMusicPlayer();
loadDiscordProfile();
loadViewCount();
setInterval(loadDiscordProfile, DISCORD.refreshMs);
