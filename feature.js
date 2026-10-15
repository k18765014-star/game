(() => {
  const telegram = window.Telegram?.WebApp;
  const initData = telegram?.initData || "";
  const walletStatus = document.getElementById("walletAuthStatus");
  const walletBalance = document.getElementById("walletBalance");
  const walletHistory = document.getElementById("walletHistory");
  let profile = null;
  let profileRefreshInFlight = false;
  let socialPollInFlight = false;
  let socialHasLoaded = false;
  let messageCursor = "0";
  let eventCursor = "0";
  let bannerTimer = null;
  const renderedMessageIds = new Set();

  if (telegram) {
    telegram.ready();
    telegram.expand();
  }

  function showStatus(message, isError = false) {
    walletStatus.textContent = message;
    walletStatus.style.color = isError ? "#ff8b80" : "#aab7c4";
  }

  async function api(path, body) {
    const headers = { "X-Telegram-Init-Data": initData };
    const options = { method: body ? "POST" : "GET", headers, cache: "no-store" };
    if (body) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || "Не удалось связаться с сервером.");
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function addHistoryRow(container, text, amount, color) {
    const row = document.createElement("div");
    row.style.cssText = "padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08);";
    const label = document.createElement("span");
    label.textContent = text;
    const value = document.createElement("strong");
    value.style.color = color;
    value.textContent = `${Number(amount).toLocaleString("ru-RU")} 💰`;
    row.append(label, document.createTextNode(" — "), value);
    container.appendChild(row);
  }

  function renderHistory() {
    walletHistory.replaceChildren();
    if (!profile?.transactions?.length) {
      walletHistory.textContent = "История переводов пока пуста.";
    } else {
      for (const item of profile.transactions) {
        const sent = String(item.from_telegram_id) === profile.id;
        const otherId = sent ? item.to_telegram_id : item.from_telegram_id;
        const label = item.kind === "admin_grant"
          ? (sent ? `Выдача игроку ${item.to_telegram_id}` : "Зачисление от администратора")
          : (sent ? `Перевод игроку ${otherId}` : `Получено от игрока ${otherId}`);
        addHistoryRow(walletHistory, label, item.amount, sent && item.kind === "transfer" ? "#ff8b80" : "#66d9a8");
      }
    }

    const adminHistory = document.getElementById("giveHistory");
    if (adminHistory) window.updateGiveHistory?.();
    renderGiftedItems();
  }

  function renderGiftedItems() {
    const container = document.getElementById("giftedItemsContainer");
    if (!container) return;
    container.replaceChildren();
    if (!profile?.items?.length) {
      container.textContent = "Пока нет предметов, выданных администратором.";
      return;
    }

    const rarityNames = {
      common: "Обычный",
      uncommon: "Необычный",
      rare: "Редкий",
      epic: "Эпический",
      legendary: "Легендарный",
      mythic: "Мифический",
      prismatic: "Призматический",
      secret: "Секретный",
      cosmic: "Космический",
      divine: "Божественный",
    };
    const grid = document.createElement("div");
    grid.className = "garage-grid";
    for (const item of profile.items) {
      const card = document.createElement("div");
      card.className = "garage-card";
      const phone = document.createElement("div");
      phone.className = "garage-name";
      phone.textContent = item.phone_name;
      const rarity = document.createElement("div");
      rarity.className = "garage-rarity";
      rarity.textContent = `${rarityNames[item.rarity] || item.rarity} · подарок`;
      const mark = document.createElement("div");
      mark.className = "garage-count";
      mark.textContent = "🎁";
      card.append(phone, rarity, mark);
      grid.appendChild(card);
    }
    container.appendChild(grid);
  }

  function renderProfile() {
    walletBalance.textContent = `${Number(profile.balance).toLocaleString("ru-RU")} 💰`;
    window.isAdmin = profile.admin;
    const adminButton = document.getElementById("adminBtn");
    if (adminButton) adminButton.style.display = profile.admin ? "inline-flex" : "none";
    showStatus(`Telegram ID: ${profile.id}`);
    renderHistory();
  }

  async function refreshProfile() {
    if (!initData) {
      window.isAdmin = false;
      const adminButton = document.getElementById("adminBtn");
      if (adminButton) adminButton.style.display = "none";
      walletBalance.textContent = "—";
      showStatus("Открой игру через Telegram, чтобы пользоваться общим кошельком.");
      walletHistory.textContent = "Переводы доступны после входа через Telegram.";
      return;
    }

    if (profileRefreshInFlight) return;
    profileRefreshInFlight = true;
    try {
      const hadProfile = profile !== null;
      const previousItemIds = new Set((profile?.items || []).map((item) => String(item.id)));
      profile = await api("/api/me");
      window.__walletAdminTransactions = profile.adminTransactions || [];
      window.__walletAdminItemGrants = profile.adminItemGrants || [];
      renderProfile();
      if (hadProfile) {
        const newItems = profile.items.filter((item) => !previousItemIds.has(String(item.id)));
        if (newItems.length) {
          window.notify?.(`🎁 Вам выдали: ${newItems[0].phone_name}`);
        }
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) profile = null;
      const knownAdmin = profile?.admin === true;
      window.isAdmin = knownAdmin;
      const adminButton = document.getElementById("adminBtn");
      if (adminButton) adminButton.style.display = knownAdmin ? "inline-flex" : "none";
      showStatus(error.message, true);
    } finally {
      profileRefreshInFlight = false;
    }
  }

  function appendChatMessage(message) {
    const feed = document.getElementById("chatMessages");
    if (!feed || !message) return;
    const messageId = String(message.id);
    if (renderedMessageIds.has(messageId)) return;

    if (feed.dataset.hasMessages !== "true") {
      feed.replaceChildren();
      feed.dataset.hasMessages = "true";
    }
    const stickToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
    const row = document.createElement("article");
    row.className = `chat-message${message.is_admin ? " is-admin" : ""}`;
    row.dataset.messageId = messageId;

    const meta = document.createElement("div");
    meta.className = "chat-message-meta";
    const author = document.createElement("span");
    author.className = "chat-message-author";
    author.textContent = message.display_name || "Игрок";
    const time = document.createElement("time");
    const createdAt = new Date(message.created_at);
    time.textContent = Number.isNaN(createdAt.getTime())
      ? ""
      : createdAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    meta.append(author, time);

    const body = document.createElement("div");
    body.className = "chat-message-body";
    body.textContent = message.message;
    row.append(meta, body);

    if (profile?.admin && message.telegram_id) {
      const userId = document.createElement("div");
      userId.className = "online-admin-id";
      userId.textContent = `Telegram ID: ${message.telegram_id}`;
      row.appendChild(userId);
    }

    feed.appendChild(row);
    renderedMessageIds.add(messageId);
    messageCursor = messageId;
    while (feed.children.length > 80) {
      const removed = feed.firstElementChild;
      if (removed?.dataset?.messageId) renderedMessageIds.delete(removed.dataset.messageId);
      removed?.remove();
    }
    if (stickToBottom) feed.scrollTop = feed.scrollHeight;
  }

  function renderChatHistory(messages) {
    const feed = document.getElementById("chatMessages");
    if (!feed) return;
    feed.replaceChildren();
    feed.dataset.hasMessages = "false";
    renderedMessageIds.clear();
    messageCursor = "0";
    for (const message of messages) appendChatMessage(message);
    if (!messages.length) {
      const empty = document.createElement("div");
      empty.className = "chat-empty";
      empty.textContent = "Сообщений пока нет. Начни разговор!";
      feed.appendChild(empty);
    } else {
      feed.scrollTop = feed.scrollHeight;
    }
  }

  function updateOnlinePlayers(players) {
    const list = document.getElementById("onlinePlayersList");
    const count = Array.isArray(players) ? players.length : 0;
    const countText = String(count);
    const headerCount = document.getElementById("headerOnlineCount");
    const panelCount = document.getElementById("onlineCount");
    const adminStatus = document.getElementById("adminLiveStatus");
    if (headerCount) headerCount.textContent = countText;
    if (panelCount) panelCount.textContent = `${countText} онлайн`;
    if (adminStatus) adminStatus.textContent = `Сейчас в игре: ${countText} игроков`;
    if (!list) return;

    list.replaceChildren();
    if (!count) {
      const empty = document.createElement("div");
      empty.className = "chat-empty";
      empty.textContent = "Пока никого нет. Позови друзей!";
      list.appendChild(empty);
      return;
    }

    for (const player of players) {
      const row = document.createElement("div");
      row.className = "online-player";
      const name = document.createElement("span");
      name.className = "online-player-name";
      name.textContent = player.display_name || "Игрок";
      row.appendChild(name);

      if (profile?.admin && player.id) {
        const actions = document.createElement("div");
        actions.className = "online-player-actions";
        const id = document.createElement("span");
        id.className = "online-admin-id";
        id.textContent = player.id;
        const grant = document.createElement("button");
        grant.type = "button";
        grant.className = "online-grant-btn";
        grant.textContent = "Выдать";
        grant.title = "Открыть панель выдачи для этого игрока";
        grant.addEventListener("click", () => {
          const recipient = document.getElementById("adminRecipient");
          const preview = document.getElementById("adminTargetPreview");
          if (recipient) {
            recipient.value = player.id;
            recipient.dataset.resolvedId = player.id;
            recipient.dataset.resolvedIdentifier = player.id;
          }
          if (preview) preview.textContent = `✅ ${player.display_name || "Игрок"} · ID ${player.id}`;
          window.openAdminPanel?.();
        });
        actions.append(id, grant);
        row.appendChild(actions);
      }
      list.appendChild(row);
    }
  }

  function showRareAnnouncement(event) {
    const banner = document.getElementById("globalRareBanner");
    if (!banner || !event) return;
    const rarityLabels = {
      prismatic: "ПРИЗМАТИЧЕСКИЙ",
      secret: "СЕКРЕТНЫЙ",
      cosmic: "КОСМИЧЕСКИЙ",
      divine: "БОЖЕСТВЕННЫЙ",
    };
    const rarityLabel = rarityLabels[event.rarity] || "РЕДКИЙ";
    banner.dataset.rarity = event.rarity;
    banner.textContent = `✨ ${event.display_name || "Игрок"} выбил ${rarityLabel}: ${event.phone_name}`;
    banner.hidden = false;
    if (bannerTimer) window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => {
      banner.hidden = true;
      bannerTimer = null;
    }, 18_000);
  }

  async function sendPresence() {
    if (!initData) return;
    try {
      await api("/api/social/presence", {});
    } catch (error) {
      const status = document.getElementById("chatStatus");
      if (status) status.textContent = error.message;
    }
  }

  async function pollSocial() {
    if (!initData || socialPollInFlight) return;
    socialPollInFlight = true;
    try {
      const payload = await api(
        `/api/social?afterMessage=${encodeURIComponent(messageCursor)}&afterEvent=${encodeURIComponent(eventCursor)}`,
      );
      updateOnlinePlayers(payload.online || []);
      const messages = payload.messages || [];
      const events = payload.events || [];
      if (!socialHasLoaded) {
        renderChatHistory(messages);
        socialHasLoaded = true;
        if (events.length) {
          const latestEvent = events[events.length - 1];
          eventCursor = String(latestEvent.id);
          const age = Date.now() - new Date(latestEvent.created_at).getTime();
          if (Number.isFinite(age) && age >= 0 && age < 120_000) {
            showRareAnnouncement(latestEvent);
          }
        }
      } else {
        for (const message of messages) appendChatMessage(message);
        for (const event of events) {
          eventCursor = String(event.id);
          showRareAnnouncement(event);
        }
      }
      const status = document.getElementById("chatStatus");
      if (status) status.textContent = "Сообщения обновляются автоматически.";
    } catch (error) {
      const status = document.getElementById("chatStatus");
      if (status) status.textContent = `Чат временно недоступен: ${error.message}`;
    } finally {
      socialPollInFlight = false;
    }
  }

  window.sendChatMessage = async function sendChatMessage(event) {
    event?.preventDefault();
    const input = document.getElementById("chatInput");
    const button = document.getElementById("chatSendBtn");
    const status = document.getElementById("chatStatus");
    const message = input?.value.trim() || "";
    if (!message) return;
    if (!initData) {
      if (status) status.textContent = "Открой игру через Telegram, чтобы писать в чат.";
      return;
    }

    if (button) button.disabled = true;
    try {
      const result = await api("/api/social/chat", { message });
      appendChatMessage(result.message);
      input.value = "";
      if (status) status.textContent = "Сообщение отправлено.";
    } catch (error) {
      if (status) status.textContent = error.message;
    } finally {
      if (button) button.disabled = false;
      input?.focus();
    }
  };

  window.publishRareDrop = async function publishRareDrop(rarity, phoneName) {
    if (!initData) return;
    try {
      await api("/api/social/rare-drop", { rarity, phoneName });
    } catch {
      // Rare-drop announcements are cosmetic and must not interrupt the game.
    }
  };

  window.setWalletGrantAmount = function setWalletGrantAmount(amount) {
    if (!profile?.admin) return showStatus("Команда доступна только администратору.", true);
    const input = document.getElementById("giveAmount");
    if (input) {
      input.value = String(amount);
      input.focus();
    }
  };

  window.sendWalletTransfer = async function sendWalletTransfer() {
    const toId = document.getElementById("walletTargetId").value.trim();
    const amount = document.getElementById("walletAmount").value.trim();
    if (!profile) return showStatus("Сначала открой игру через Telegram.", true);
    try {
      const result = await api("/api/wallet/transfer", { toId, amount });
      document.getElementById("walletTargetId").value = "";
      document.getElementById("walletAmount").value = "";
      await refreshProfile();
      const player = result.player;
      window.notify?.(`Перевод выполнен: ${player?.username ? `@${player.username}` : player?.displayName || toId}`);
    } catch (error) {
      showStatus(error.message, true);
    }
  };

  window.giveMoneyToUser = async function giveMoneyToUser() {
    if (!profile?.admin) return showStatus("Команда доступна только администратору.", true);
    const recipient = document.getElementById("adminRecipient");
    const toId = recipient?.value.trim() || "";
    const amount = document.getElementById("giveAmount").value.trim();
    const button = document.getElementById("grantMoneyBtn");
    const status = document.getElementById("adminActionStatus");
    if (!toId) {
      if (status) status.textContent = "Сначала укажи ID или @username игрока.";
      return;
    }
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      const result = await api("/api/admin/grant", { toId, amount });
      if (result.player && recipient) {
        recipient.dataset.resolvedId = result.player.id;
        recipient.dataset.resolvedIdentifier = toId;
        const preview = document.getElementById("adminTargetPreview");
        if (preview) preview.textContent = `✅ ${result.player.username ? `@${result.player.username}` : result.player.displayName} · ID ${result.player.id}`;
      }
      document.getElementById("giveAmount").value = "";
      await refreshProfile();
      const playerLabel = result.player?.username ? `@${result.player.username}` : result.player?.displayName || toId;
      if (status) status.textContent = `✅ Игроку ${playerLabel} выдано ${Number(amount).toLocaleString("ru-RU")} монет.`;
      window.notify?.(`Выдано игроку ${playerLabel}.`);
    } catch (error) {
      if (status) status.textContent = `⚠️ ${error.message}`;
    } finally {
      if (button) button.disabled = false;
    }
  };

  window.clearAdminRecipientPreview = function clearAdminRecipientPreview() {
    const recipient = document.getElementById("adminRecipient");
    const preview = document.getElementById("adminTargetPreview");
    if (recipient) {
      delete recipient.dataset.resolvedId;
      delete recipient.dataset.resolvedIdentifier;
    }
    if (preview) preview.textContent = "Введи ID или @username, затем нажми «Найти игрока».";
  };

  window.resolveAdminRecipient = async function resolveAdminRecipient() {
    if (!profile?.admin) return showStatus("Команда доступна только администратору.", true);
    const recipient = document.getElementById("adminRecipient");
    const preview = document.getElementById("adminTargetPreview");
    const button = document.getElementById("resolveAdminRecipientBtn");
    const identifier = recipient?.value.trim() || "";
    if (!identifier) {
      if (preview) preview.textContent = "Сначала введи Telegram ID или @username.";
      return;
    }
    if (button?.disabled) return;
    if (button) button.disabled = true;
    if (preview) preview.textContent = "Ищем игрока…";
    try {
      const result = await api("/api/admin/resolve-player", { identifier });
      if (recipient?.value.trim() !== identifier) return;
      const player = result.player;
      recipient.dataset.resolvedId = player.id;
      recipient.dataset.resolvedIdentifier = identifier;
      if (preview) {
        preview.textContent = `✅ ${player.username ? `@${player.username}` : player.displayName} · ID ${player.id} · кошелёк ${Number(player.balance).toLocaleString("ru-RU")} 💰`;
      }
    } catch (error) {
      if (preview) preview.textContent = `⚠️ ${error.message}`;
    } finally {
      if (button) button.disabled = false;
    }
  };

  window.updateGiftItemOptions = function updateGiftItemOptions() {
    const raritySelect = document.getElementById("giveItemRarity");
    const phoneSelect = document.getElementById("giveItemName");
    if (!raritySelect || !phoneSelect || typeof PHONES === "undefined") return;
    const rarity = raritySelect.value;
    phoneSelect.replaceChildren();
    for (const phone of PHONES[rarity]?.phones || []) {
      const option = document.createElement("option");
      option.value = phone;
      option.textContent = phone;
      phoneSelect.appendChild(option);
    }
  };

  window.giveItemToUser = async function giveItemToUser() {
    if (!profile?.admin) return showStatus("Команда доступна только администратору.", true);
    const recipient = document.getElementById("adminRecipient");
    const toId = recipient?.value.trim() || "";
    const rarity = document.getElementById("giveItemRarity").value;
    const phoneName = document.getElementById("giveItemName").value;
    const button = document.getElementById("grantItemBtn");
    const status = document.getElementById("adminActionStatus");
    if (!toId) {
      if (status) status.textContent = "Сначала укажи ID или @username игрока.";
      return;
    }
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      const result = await api("/api/admin/items/grant", { toId, rarity, phoneName });
      if (result.player && recipient) {
        recipient.dataset.resolvedId = result.player.id;
        recipient.dataset.resolvedIdentifier = toId;
        const preview = document.getElementById("adminTargetPreview");
        if (preview) preview.textContent = `✅ ${result.player.username ? `@${result.player.username}` : result.player.displayName} · ID ${result.player.id}`;
      }
      await refreshProfile();
      const playerLabel = result.player?.username ? `@${result.player.username}` : result.player?.displayName || toId;
      if (status) status.textContent = `✅ «${phoneName}» выдан игроку ${playerLabel}.`;
      window.notify?.(`Предмет «${phoneName}» выдан.`);
    } catch (error) {
      if (status) status.textContent = `⚠️ ${error.message}`;
    } finally {
      if (button) button.disabled = false;
    }
  };

  window.updateGiveHistory = function updateGiveHistory() {
    const container = document.getElementById("giveHistory");
    if (!container) return;
    container.replaceChildren();
    const history = window.__walletAdminTransactions || [];
    if (!history.length) {
      container.textContent = "История выдач пока пуста.";
    } else {
      for (const item of history) {
        const label = item.kind === "admin_grant"
          ? `ID ${item.to_telegram_id}`
          : `Перевод: ${item.from_telegram_id} → ${item.to_telegram_id}`;
        addHistoryRow(container, label, item.amount, "#f3b64a");
      }
    }

    const itemContainer = document.getElementById("giveItemHistory");
    if (itemContainer) {
      itemContainer.replaceChildren();
      const itemHistory = window.__walletAdminItemGrants || [];
      if (!itemHistory.length) {
        itemContainer.textContent = "Выданных предметов пока нет.";
      } else {
        for (const item of itemHistory) {
          const row = document.createElement("div");
          row.style.cssText = "padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08);";
          row.textContent = `ID ${item.telegram_id} ← ${item.phone_name} (${item.rarity})`;
          itemContainer.appendChild(row);
        }
      }
    }
  };

  window.updateGiftItemOptions();
  refreshProfile();
  if (initData) {
    window.setInterval(() => {
      if (document.visibilityState === "visible") refreshProfile();
    }, 15_000);
    sendPresence();
    pollSocial();
    window.setInterval(pollSocial, 6_000);
    window.setInterval(sendPresence, 15_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshProfile();
        sendPresence();
        pollSocial();
      }
    });
  } else {
    const status = document.getElementById("chatStatus");
    if (status) status.textContent = "Открой игру через Telegram, чтобы пользоваться чатом.";
  }
})();
