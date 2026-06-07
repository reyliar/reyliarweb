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
  autoplayRetryMs: 420,
  autoplayAttempts: 8,
  playlist: [
    {
      videoId: "LHLumo6sDG4",
      title: "ice - super slowed",
      thumbnail: "https://i.ytimg.com/vi/LHLumo6sDG4/hqdefault.jpg",
    },
    {
      videoId: "RTUr_ZD0niQ",
      title: "esdeekid - mist // slowed & reverb",
      thumbnail: "https://i.ytimg.com/vi/RTUr_ZD0niQ/hqdefault.jpg",
    },
    {
      videoId: "eMOKD-RUfIg",
      title: "pinkpantheress - pain (slowed + reverb)",
      thumbnail: "https://i.ytimg.com/vi/eMOKD-RUfIg/hqdefault.jpg",
    },
    {
      videoId: "ZGSl0qBifII",
      title: "cult member - u weren't here i really miss you (slowed x reverb)",
      thumbnail: "https://i.ytimg.com/vi/ZGSl0qBifII/hqdefault.jpg",
    },
    {
      videoId: "76kMS0DzXIQ",
      title: "ECSTACY (SLOWED + REVERB)",
      thumbnail: "https://i.ytimg.com/vi/76kMS0DzXIQ/hqdefault.jpg",
    },
  ],
};

const selectors = {
  enterScreen: "#enter-screen",
  enterButton: "#enter-button",
  pageShell: ".page-shell",
  siteFooter: ".site-footer",
  profilePanel: ".profile-panel",
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
  musicPrev: "#music-prev",
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
let musicAutoplayTimer = null;
let musicAutoplayAttempts = 0;
let lastMusicVolume = MUSIC.defaultVolume;
let musicIndex = 0;
let pageFitFrame = 0;

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

  if (el.musicCover && el.musicCover.src !== track.thumbnail) {
    el.musicCover.src = track.thumbnail;
  }

  schedulePageFit();
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
  allowYoutubeAutoplay();
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
      scheduleMusicAutoplayRetry();
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
    clearMusicAutoplayRetry();
    musicAutoplayAttempts = 0;
    setMusicStatus("playing");
  } else if (event.data === states.PAUSED) {
    if (musicWantsPlay) {
      setMusicStatus("loading");
      scheduleMusicAutoplayRetry();
    } else {
      setMusicStatus("paused");
    }
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
  clearMusicAutoplayRetry();
  setMusicStatus("error");
}

function allowYoutubeAutoplay() {
  const iframe = el.youtubePlayer?.querySelector("iframe");
  if (!iframe) return;

  iframe.setAttribute("allow", "autoplay; encrypted-media");
}

function createYoutubePlayer() {
  if (youtubePlayer || !el.youtubePlayer || !window.YT?.Player) return;

  const playerVars = {
    autoplay: musicWantsPlay ? 1 : 0,
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
  window.setTimeout(allowYoutubeAutoplay, 0);
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

function clearMusicAutoplayRetry() {
  if (!musicAutoplayTimer) return;
  window.clearTimeout(musicAutoplayTimer);
  musicAutoplayTimer = null;
}

function retryMusicAutoplay() {
  musicAutoplayTimer = null;

  if (!musicWantsPlay) {
    musicAutoplayAttempts = 0;
    return;
  }

  const states = window.YT?.PlayerState || {};
  const state = getMusicValue("getPlayerState");

  if (state === states.PLAYING) {
    musicAutoplayAttempts = 0;
    return;
  }

  if (youtubeReady && youtubePlayer?.playVideo) {
    try {
      youtubePlayer.playVideo();
      setMusicStatus("loading");
    } catch {
      setMusicStatus("error");
      musicWantsPlay = false;
      musicAutoplayAttempts = 0;
      return;
    }
  } else {
    setMusicStatus("loading");
    loadYouTubeApi();
  }

  musicAutoplayAttempts += 1;
  if (musicAutoplayAttempts < MUSIC.autoplayAttempts) {
    musicAutoplayTimer = window.setTimeout(retryMusicAutoplay, MUSIC.autoplayRetryMs);
  } else {
    musicAutoplayAttempts = 0;
  }
}

function scheduleMusicAutoplayRetry() {
  clearMusicAutoplayRetry();
  musicAutoplayAttempts = 0;
  musicAutoplayTimer = window.setTimeout(retryMusicAutoplay, MUSIC.autoplayRetryMs);
}

function playMusic() {
  musicWantsPlay = true;

  if (!youtubeReady || !youtubePlayer?.playVideo) {
    setMusicStatus("loading");
    loadYouTubeApi();
    scheduleMusicAutoplayRetry();
    return;
  }

  try {
    youtubePlayer.playVideo();
    setMusicStatus("loading");
    scheduleMusicAutoplayRetry();
  } catch {
    setMusicStatus("error");
  }
}

function pauseMusic() {
  musicWantsPlay = false;
  clearMusicAutoplayRetry();

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
  if (!autoplay) clearMusicAutoplayRetry();
  updateMusicTrackUi();
  resetMusicProgress();

  if (!youtubeReady || !youtubePlayer) {
    setMusicStatus(autoplay ? "loading" : "ready");
    loadYouTubeApi();
    if (autoplay) scheduleMusicAutoplayRetry();
    return;
  }

  const track = currentTrack();

  try {
    if (autoplay) {
      youtubePlayer.loadVideoById(track.videoId);
      setMusicStatus("loading");
      scheduleMusicAutoplayRetry();
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

function previousMusic(forceAutoplay) {
  const states = window.YT?.PlayerState || {};
  const state = getMusicValue("getPlayerState");
  const shouldAutoplay = forceAutoplay ?? (musicWantsPlay || state === states.PLAYING || state === states.BUFFERING);
  loadMusicTrack(musicIndex - 1, shouldAutoplay);
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

  loadMusicTrack(musicIndex, true);
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
  el.musicPrev?.addEventListener("click", () => previousMusic());
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

function fitPageToViewport() {
  if (!el.pageShell || !el.profilePanel) return;

  const shellStyle = window.getComputedStyle(el.pageShell);
  const paddingY = (parseFloat(shellStyle.paddingTop) || 0) + (parseFloat(shellStyle.paddingBottom) || 0);
  const gap = parseFloat(shellStyle.rowGap || shellStyle.gap) || 0;
  const footerHeight = el.siteFooter?.offsetHeight || 0;
  const panelHeight = Math.max(el.profilePanel.offsetHeight, el.profilePanel.scrollHeight);
  const requiredHeight = panelHeight + footerHeight + gap + paddingY;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || requiredHeight;
  const nextScale = Math.min(1, Math.max(0.62, (viewportHeight - 48) / requiredHeight));
  const currentScale = Number(el.pageShell.style.getPropertyValue("--page-fit-scale")) || 1;

  if (Math.abs(nextScale - currentScale) > 0.003) {
    el.pageShell.style.setProperty("--page-fit-scale", nextScale.toFixed(3));
  }
}

function schedulePageFit() {
  if (pageFitFrame) window.cancelAnimationFrame(pageFitFrame);
  pageFitFrame = window.requestAnimationFrame(() => {
    pageFitFrame = 0;
    fitPageToViewport();
  });
}

function setPanelTiltStyle(values = {}) {
  if (!el.profilePanel) return;

  const {
    rotateX = "0deg",
    rotateY = "0deg",
    shiftX = "0px",
    shiftY = "0px",
    glareX = "50%",
    glareY = "50%",
    glow = "0",
  } = values;

  el.profilePanel.style.setProperty("--panel-tilt-x", rotateX);
  el.profilePanel.style.setProperty("--panel-tilt-y", rotateY);
  el.profilePanel.style.setProperty("--panel-shift-x", shiftX);
  el.profilePanel.style.setProperty("--panel-shift-y", shiftY);
  el.profilePanel.style.setProperty("--panel-glare-x", glareX);
  el.profilePanel.style.setProperty("--panel-glare-y", glareY);
  el.profilePanel.style.setProperty("--panel-glow", glow);
}

function initProfilePanelTilt() {
  if (!el.profilePanel) return;

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (reducedMotion?.matches) return;

  let frame = 0;
  let nextTilt = null;

  const applyTilt = () => {
    frame = 0;
    setPanelTiltStyle(nextTilt);
  };

  const queueTilt = (tilt) => {
    nextTilt = tilt;
    if (!frame) frame = window.requestAnimationFrame(applyTilt);
  };

  const resetTilt = () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    nextTilt = null;
    setPanelTiltStyle();
  };

  el.profilePanel.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;

    const rect = el.profilePanel.getBoundingClientRect();
    const x = clampNumber((event.clientX - rect.left) / rect.width, 0, 1, 0.5);
    const y = clampNumber((event.clientY - rect.top) / rect.height, 0, 1, 0.5);
    const offsetX = (x * 2) - 1;
    const offsetY = (y * 2) - 1;
    const glow = Math.min(1, Math.hypot(offsetX, offsetY) / Math.SQRT2);

    queueTilt({
      rotateX: `${(-offsetY * 8).toFixed(2)}deg`,
      rotateY: `${(offsetX * 10).toFixed(2)}deg`,
      shiftX: `${(offsetX * 4).toFixed(2)}px`,
      shiftY: `${(offsetY * 3).toFixed(2)}px`,
      glareX: `${(x * 100).toFixed(1)}%`,
      glareY: `${(y * 100).toFixed(1)}%`,
      glow: glow.toFixed(3),
    });
  });

  el.profilePanel.addEventListener("pointerleave", resetTilt);
  el.profilePanel.addEventListener("pointercancel", resetTilt);
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
  schedulePageFit();
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
  schedulePageFit();
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
    schedulePageFit();
  } catch (error) {
    console.warn("View count could not be loaded:", error);
    setText(el.viewCount, "0");
    schedulePageFit();
  }
}

initMusicPlayer();
initProfilePanelTilt();
schedulePageFit();
window.addEventListener("resize", schedulePageFit);
window.addEventListener("orientationchange", schedulePageFit);
window.addEventListener("load", schedulePageFit);
document.fonts?.ready?.then(schedulePageFit);
loadDiscordProfile();
loadViewCount();
setInterval(loadDiscordProfile, DISCORD.refreshMs);
