(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const byId = (id) => document.getElementById(id);

  const dom = {
    agentStatus: byId("agentStatus"),
    statusText: $("#agentStatus > span:last-child"),
    voiceStage: byId("voiceStage"),
    voiceStageLabel: byId("voiceStageLabel"),
    micButton: byId("micButton"),
    speakButton: byId("speakButton"),
    speakButtonText: $("#speakButton span"),
    agentHeadline: byId("agentHeadline"),
    agentSubline: byId("agentSubline"),
    transcriptText: byId("transcriptText"),
    typeButton: byId("typeButton"),
    typedForm: byId("typedCommandForm"),
    commandInput: byId("commandInput"),
    closeTyping: byId("closeTyping"),
    languageSelect: byId("languageSelect"),
    reviewEmpty: byId("reviewEmpty"),
    reviewContent: byId("reviewContent"),
    stepList: byId("stepList"),
    toast: byId("toast"),
    toastMessage: byId("toastMessage"),
    auditModal: byId("auditModal"),
    auditEntries: byId("auditEntries"),
    infoModal: byId("infoModal"),
    infoTitle: byId("infoTitle"),
    infoKicker: byId("infoKicker"),
    infoBody: byId("infoBody"),
  };

  const payeeProfiles = {
    sharma: {
      name: "Sharma Kirana",
      short: "SK",
      vpa: "sharmakirana@ybl",
      usual: 500,
      payments: 18,
      lastPaid: "2 days ago",
      avatar: "yellow",
      trusted: true,
    },
    rakesh: {
      name: "Rakesh Medical",
      short: "RM",
      vpa: "rakesh.med@ybl",
      usual: 240,
      payments: 9,
      lastPaid: "5 days ago",
      avatar: "purple",
      trusted: true,
    },
    mehta: {
      name: "Mehta Utilities",
      short: "MU",
      vpa: "mehta.utility@ybl",
      usual: 1200,
      payments: 6,
      lastPaid: "11 days ago",
      avatar: "blue",
      trusted: true,
    },
  };

  const demoPhrases = {
    safe: "Sharma kirana ko paanch sau rupaye bhejo",
    inflated: "Sharma kirana ko pachaas hazaar rupaye bhejo",
    collect: "Sharma kirana ne pachaas hazaar ka collect request bheja hai",
    mismatch: "Sharma kirana ko paanch sau rupaye bhejo",
  };

  const statusCopy = {
    ready: {
      label: "Ready to listen",
      headline: "What would you like to pay for?",
      subline: "Say it naturally. I will repeat the amount and payee before anything moves.",
      stage: "Tap to speak",
      button: "Start speaking",
    },
    listening: {
      label: "Listening now",
      headline: "I am listening…",
      subline: "Tell me who to pay and how much. You can speak in Hindi, English, or Hinglish.",
      stage: "Listening",
      button: "Stop listening",
    },
    analyzing: {
      label: "Understanding request",
      headline: "Let me check that…",
      subline: "I am resolving the payee and looking for anything unusual.",
      stage: "Thinking",
      button: "Start speaking",
    },
    review: {
      label: "Your confirmation",
      headline: "Please check what I heard.",
      subline: "I will wait for your yes. No payment can happen silently.",
      stage: "Review",
      button: "Start speaking",
    },
    guard: {
      label: "Safety check needs you",
      headline: "Pause. Something needs a closer look.",
      subline: "I found a signal worth explaining before you decide.",
      stage: "Safety check",
      button: "Start speaking",
    },
    processing: {
      label: "Sending in test mode",
      headline: "One moment…",
      subline: "Your confirmation was received. I am sending this through the Razorpay sandbox.",
      stage: "Processing",
      button: "Please wait",
    },
    success: {
      label: "All done",
      headline: "That is taken care of.",
      subline: "The outcome is recorded in your caregiver audit log.",
      stage: "Done",
      button: "Start a new payment",
    },
    blocked: {
      label: "Request declined",
      headline: "Nothing left your account.",
      subline: "The suspicious request was declined and recorded for review.",
      stage: "Protected",
      button: "Start a new payment",
    },
  };

  const appState = {
    status: "ready",
    pending: null,
    lastPayment: null,
    listening: false,
    analysisToken: 0,
    analysisTimer: null,
    processingTimer: null,
    riskAcknowledged: false,
    collectAcknowledged: false,
    toastTimer: null,
    recognition: null,
    audit: [
      {
        time: "Session start",
        label: "Safety session opened",
        detail: "Voice confirmations and guardrails are active.",
        tone: "safe",
        icon: "shield",
      },
    ],
  };

  const formatCurrency = (amount) => `₹${new Intl.NumberFormat("en-IN").format(amount)}`;
  const formatNumber = (amount) => new Intl.NumberFormat("en-IN").format(amount);
  const timeNow = () =>
    new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date());

  const escapeHTML = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const speak = (text) => {
    if (!("speechSynthesis" in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = dom.languageSelect?.value || "en-IN";
      utterance.rate = 0.92;
      utterance.pitch = 1;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((voice) => voice.lang?.toLowerCase() === utterance.lang.toLowerCase()) ||
        voices.find((voice) => voice.lang?.toLowerCase().startsWith(utterance.lang.slice(0, 2).toLowerCase()));
      if (preferred) utterance.voice = preferred;
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      // Speech is progressive enhancement; the visual flow remains usable when unavailable.
    }
  };

  const showToast = (message, tone = "safe") => {
    if (!dom.toast) return;
    dom.toastMessage.textContent = message;
    dom.toast.classList.toggle("toast-danger", tone === "danger");
    dom.toast.classList.add("show");
    window.clearTimeout(appState.toastTimer);
    appState.toastTimer = window.setTimeout(() => dom.toast.classList.remove("show"), 3200);
  };

  const setTranscript = (text) => {
    dom.transcriptText.textContent = `“${text}”`;
  };

  const setState = (nextStatus) => {
    const copy = statusCopy[nextStatus] || statusCopy.ready;
    appState.status = nextStatus;

    dom.agentStatus.className = "agent-status";
    if (["listening", "analyzing", "review", "guard", "processing", "success"].includes(nextStatus)) {
      dom.agentStatus.classList.add(nextStatus);
    }
    dom.statusText.textContent = copy.label;
    dom.voiceStage.className = "voice-stage";
    dom.voiceStage.classList.add(nextStatus);
    dom.voiceStageLabel.textContent = copy.stage;
    dom.agentHeadline.textContent = copy.headline;
    dom.agentSubline.textContent = copy.subline;
    dom.speakButtonText.textContent = copy.button;
    dom.speakButton.classList.toggle("is-listening", nextStatus === "listening");
    dom.speakButton.setAttribute("aria-label", copy.button);
    dom.micButton.setAttribute("aria-label", copy.button);
    dom.micButton.disabled = ["analyzing", "processing"].includes(nextStatus);

    updateAgentSteps(nextStatus);
  };

  const updateAgentSteps = (status) => {
    const progress = {
      ready: { active: 0, done: -1 },
      listening: { active: 0, done: -1 },
      analyzing: { active: 1, done: 0 },
      review: { active: 2, done: 1 },
      guard: { active: 3, done: 2 },
      processing: { active: 4, done: 3 },
      success: { active: -1, done: 4 },
      blocked: { active: 3, done: 2 },
    }[status] || { active: 0, done: -1 };

    const stepNames = ["understand", "check", "confirm", "guard", "execute"];
    $$(".agent-step", dom.stepList).forEach((step, index) => {
      const stateLabel = $(".step-state", step);
      step.classList.remove("active", "done", "guard-active");
      if (index <= progress.done) {
        step.classList.add("done");
        stateLabel.textContent = "done";
      } else if (index === progress.active) {
        step.classList.add("active");
        if (status === "guard" || status === "blocked") step.classList.add("guard-active");
        stateLabel.textContent = status === "success" ? "done" : "working";
      } else {
        stateLabel.textContent = "waiting";
      }
      step.dataset.step = stepNames[index];
    });
  };

  const amountInWords = (amount) => {
    const known = {
      240: "two hundred and forty",
      500: "five hundred",
      1200: "one thousand two hundred",
      2000: "two thousand",
      5000: "five thousand",
      50000: "fifty thousand",
    };
    return known[amount] || `${formatNumber(amount)} rupees`;
  };

  const parseAmount = (text) => {
    const normalized = text.toLowerCase().replaceAll(",", "").replaceAll("₹", "");
    const phraseAmounts = [
      [/pachaas\s*(hazaar|hazar)|pachas\s*(hazaar|hazar)|fifty\s*thousand|fifty\s*k\b/, 50000],
      [/paanch\s*(sau| सौ)|panch\s*(sau| सौ)|five\s*hundred/, 500],
      [/do\s*(hazaar|hazar)|two\s*thousand/, 2000],
      [/baarah\s*sau|barah\s*sau|twelve\s*hundred/, 1200],
      [/do\s*sau\s*chaalees|two\s*hundred\s*and\s*forty/, 240],
      [/paanch\s*hazaar|panch\s*hazaar|five\s*thousand/, 5000],
    ];
    for (const [pattern, amount] of phraseAmounts) {
      if (pattern.test(normalized)) return amount;
    }

    const compactMatch = normalized.match(/(?:rs\.?|inr|rupees?)?\s*(\d{2,7})(?:\s*(?:rupees?|rs\.?))?/i);
    if (compactMatch) return Number(compactMatch[1]);

    const shortK = normalized.match(/(\d+(?:\.\d+)?)\s*k\b/i);
    if (shortK) return Math.round(Number(shortK[1]) * 1000);

    return 500;
  };

  const resolvePayee = (text, demoType) => {
    const normalized = text.toLowerCase();
    if (demoType === "mismatch" || /lookalike|wrong\s*(account|payee)|different\s*(account|name)|duplicate/.test(normalized)) {
      return {
        name: "Sharma Kiran Store",
        requestedName: "Sharma Kirana",
        short: "SK",
        vpa: "sharma.kirana@okaxis",
        usual: 500,
        payments: 0,
        lastPaid: "never",
        avatar: "unknown",
        trusted: false,
        mismatch: true,
      };
    }
    if (/rakesh|medical|दवा|dawai/.test(normalized)) return payeeProfiles.rakesh;
    if (/mehta|utility|bijli|electricity/.test(normalized)) return payeeProfiles.mehta;
    if (/unknown|new\s*(person|payee)|not\s*(saved|sure)/.test(normalized)) {
      return {
        name: "Aman Traders",
        requestedName: "Aman Traders",
        short: "AT",
        vpa: "aman.traders@paytm",
        usual: 0,
        payments: 0,
        lastPaid: "never",
        avatar: "unknown",
        trusted: false,
        mismatch: false,
      };
    }
    return payeeProfiles.sharma;
  };

  const parseCommand = (rawText, demoType = "") => {
    const raw = rawText.trim();
    const normalized = raw.toLowerCase();
    const isCollect = demoType === "collect" || /collect\s*request|request\s*(for|to)|pull\s*request|paise\s*(maang|mang)|take\s*money/.test(normalized);
    const payee = resolvePayee(raw, demoType);
    const amount = parseAmount(raw);
    const flags = [];

    if (isCollect) flags.push("collect");
    if (payee.mismatch || !payee.trusted) flags.push("payee");
    if (payee.usual && amount >= Math.max(5000, payee.usual * 10)) flags.push("amount");
    else if (payee.usual && amount >= payee.usual * 3) flags.push("amount-elevated");

    const amountMultiplier = payee.usual ? Math.round(amount / payee.usual) : null;
    const riskLevel = isCollect ? "critical" : flags.length ? "high" : "low";
    const riskAcknowledgement = flags.includes("amount") || flags.includes("amount-elevated") || flags.includes("payee") || !payee.trusted;
    const intentId = `INT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    return {
      raw,
      amount,
      amountWords: amountInWords(amount),
      payee,
      isCollect,
      flags,
      amountMultiplier,
      riskLevel,
      riskAcknowledgement,
      intentId,
      direction: isCollect ? "Money out · collect request" : "Payment out · user started",
    };
  };

  const addAudit = (label, detail, tone = "safe", icon = "check") => {
    appState.audit.unshift({ time: timeNow(), label, detail, tone, icon });
    if (appState.audit.length > 14) appState.audit.length = 14;
    renderAudit();
  };

  const renderAudit = () => {
    if (!dom.auditEntries) return;
    if (!appState.audit.length) {
      dom.auditEntries.innerHTML = '<div class="empty-audit">No events in this session yet.</div>';
      return;
    }
    dom.auditEntries.innerHTML = appState.audit
      .map(
        (entry) => `
          <div class="audit-entry">
            <span class="audit-time">${escapeHTML(entry.time)}</span>
            <span class="audit-entry-icon ${entry.tone === "danger" ? "danger" : entry.tone === "warning" ? "warning" : ""}"><svg><use href="#icon-${entry.icon || "check"}"></use></svg></span>
            <span class="audit-entry-copy"><strong>${escapeHTML(entry.label)}</strong><span>${escapeHTML(entry.detail)}</span></span>
          </div>`,
      )
      .join("");
  };

  const showReviewLoading = () => {
    dom.reviewEmpty.classList.add("hidden");
    dom.reviewContent.classList.remove("hidden");
    dom.reviewContent.innerHTML = `
      <div class="processing-view">
        <div>
          <div class="processing-spinner"></div>
          <h2>Checking the details</h2>
          <p>Matching the payee, amount, and direction against your safe patterns.</p>
        </div>
      </div>`;
  };

  const signalHTML = (icon, label, value, tone = "safe") => `
    <div class="signal-pill ${tone === "safe" ? "" : tone}">
      <svg><use href="#icon-${icon}"></use></svg>
      <span><strong>${escapeHTML(label)}</strong><small>${escapeHTML(value)}</small></span>
    </div>`;

  const renderReview = (payment) => {
    const p = payment;
    const isCritical = p.isCollect;
    const isHigh = !isCritical && p.riskLevel === "high";
    const payeeTone = p.payee.trusted && !p.payee.mismatch ? "safe" : "alert";
    const amountTone = p.flags.includes("amount") ? "alert" : p.flags.includes("amount-elevated") ? "warning" : "safe";
    const directionTone = p.isCollect ? "alert" : "safe";
    const avatarClass = p.isCollect || !p.payee.trusted ? "unknown" : "";
    const riskLabel = isCritical ? "Critical safety alert" : isHigh ? "Needs your attention" : "Looks safe to continue";
    const riskIcon = isCritical || isHigh ? "alert" : "shield";

    let decisionTitle = "Looks safe to continue";
    let decisionText = `${formatCurrency(p.amount)} is within your usual pattern for ${p.payee.name}. I found a trusted payee match.`;
    let decisionClass = "";
    if (p.isCollect) {
      decisionTitle = "Stop — this would take money from you";
      decisionText = `This is a collect request for ${formatCurrency(p.amount)}. It is asking your account to pay out; it is not a payment you started.`;
      decisionClass = "danger";
    } else if (p.payee.mismatch || !p.payee.trusted) {
      decisionTitle = "Pause — the account name does not match";
      decisionText = `You asked for “${p.payee.requestedName || p.payee.name}”, but the account is named “${p.payee.name}”. This could be a lookalike payee.`;
      decisionClass = "warning";
    } else if (p.flags.includes("amount")) {
      decisionTitle = "Pause — this amount is unusually large";
      decisionText = `${formatCurrency(p.amount)} is ${p.amountMultiplier}× your usual ${formatCurrency(p.payee.usual)} payment to this shop. Please verify it out loud.`;
      decisionClass = "warning";
    } else if (p.flags.includes("amount-elevated")) {
      decisionTitle = "Take a second look at the amount";
      decisionText = `${formatCurrency(p.amount)} is higher than your usual ${formatCurrency(p.payee.usual)} payment to this payee.`;
      decisionClass = "warning";
    }

    let extraAction = "";
    if (p.isCollect && !appState.collectAcknowledged) {
      extraAction = `
        <div class="review-actions">
          <button class="primary-button danger" id="declineButton" type="button"><svg><use href="#icon-shield"></use></svg>Say NO · decline request</button>
          <button class="secondary-button" id="expectButton" type="button">I expected this</button>
        </div>`;
    } else if (p.isCollect && appState.collectAcknowledged) {
      extraAction = `
        <div class="ack-row"><button class="checked" id="ackRisk" type="button" aria-label="Remove expected request acknowledgement"><svg><use href="#icon-check"></use></svg></button><span>You said you expected this request. You will still authenticate in your bank app before any test action.</span></div>
        <div class="review-actions">
          <button class="primary-button warning" id="confirmPayment" type="button">Authenticate & continue</button>
          <button class="cancel-action" id="cancelReview" type="button">Cancel</button>
        </div>`;
    } else if (p.riskAcknowledgement) {
      extraAction = `
        <div class="ack-row"><button id="ackRisk" type="button" aria-label="Acknowledge safety warning" class="${appState.riskAcknowledged ? "checked" : ""}"><svg><use href="#icon-check"></use></svg></button><span>I heard this warning and have independently verified the amount and account name.</span></div>
        <div class="review-actions">
          <button class="primary-button warning" id="confirmPayment" type="button" ${appState.riskAcknowledged ? "" : "disabled"}>${appState.riskAcknowledged ? "Pay anyway · test mode" : "Acknowledge warning first"}</button>
          <button class="cancel-action" id="cancelReview" type="button">Cancel</button>
        </div>`;
    } else {
      extraAction = `
        <div class="review-actions">
          <button class="primary-button" id="confirmPayment" type="button"><svg><use href="#icon-check"></use></svg>Say YES · confirm payment</button>
          <button class="secondary-button" id="editReview" type="button">Change details</button>
        </div>`;
    }

    dom.reviewEmpty.classList.add("hidden");
    dom.reviewContent.classList.remove("hidden");
    dom.reviewContent.innerHTML = `
      <div class="review-head"><span class="section-kicker">AGENT SUMMARY</span><span class="review-ref">${escapeHTML(p.intentId)} · ${escapeHTML(riskLabel)}</span></div>
      <div class="transaction-summary">
        <div class="summary-avatar ${avatarClass} ${p.isCollect ? "collect" : ""}">${escapeHTML(p.payee.short)}</div>
        <div class="summary-copy"><span>${p.isCollect ? "Requested by" : "Sending to"}</span><strong>${escapeHTML(p.payee.name)}</strong><small>${escapeHTML(p.payee.vpa)}</small></div>
        <div class="summary-amount"><strong>${formatCurrency(p.amount)}</strong><span>${escapeHTML(p.direction)}</span></div>
      </div>
      <div class="risk-grid">
        ${signalHTML("shield", "Payee", p.payee.trusted && !p.payee.mismatch ? "Trusted match" : "Name mismatch", payeeTone)}
        ${signalHTML("activity", "Amount", p.flags.includes("amount") ? `${p.amountMultiplier}× your usual` : p.flags.includes("amount-elevated") ? "Higher than usual" : "Within pattern", amountTone)}
        ${signalHTML(p.isCollect ? "arrow-up-right" : "send", "Direction", p.isCollect ? "Pulls money out" : "You started it", directionTone)}
      </div>
      <div class="decision-box ${decisionClass}"><svg><use href="#icon-${riskIcon}"></use></svg><div><strong>${escapeHTML(decisionTitle)}</strong><p>${escapeHTML(decisionText)}</p></div></div>
      ${extraAction}
      <div class="reasoning-line"><svg><use href="#icon-sliders"></use></svg><span>Agent checked ${p.payee.trusted ? "payee history" : "payee identity"}, amount pattern, and payment direction.</span></div>`;

    bindReviewActions(p);
  };

  const bindReviewActions = (payment) => {
    const confirmButton = byId("confirmPayment");
    const declineButton = byId("declineButton");
    const expectButton = byId("expectButton");
    const ackButton = byId("ackRisk");
    const cancelButton = byId("cancelReview");
    const editButton = byId("editReview");

    confirmButton?.addEventListener("click", () => {
      if (payment.riskAcknowledgement && !appState.riskAcknowledged) {
        showToast("Please acknowledge the spoken warning first.", "danger");
        speak("Please acknowledge the warning after you verify the details.");
        return;
      }
      executePayment(payment);
    });

    declineButton?.addEventListener("click", () => declineCollect(payment));

    expectButton?.addEventListener("click", () => {
      appState.collectAcknowledged = true;
      addAudit("User decision", "Marked the collect request as expected; authentication is still required.", "warning", "alert");
      renderReview(payment);
      setState("guard");
      speak("You marked this request as expected. It would still take money from you. Continue only if you recognize the sender.");
    });

    ackButton?.addEventListener("click", () => {
      if (payment.isCollect) {
        appState.collectAcknowledged = false;
      } else {
        appState.riskAcknowledged = !appState.riskAcknowledged;
      }
      renderReview(payment);
      setState(payment.isCollect || payment.riskAcknowledgement ? "guard" : "review");
      if (appState.riskAcknowledged) {
        addAudit("Warning acknowledged", "User confirmed they independently verified the amount and payee.", "warning", "alert");
        speak("Warning acknowledged. Say yes only if you verified the details yourself.");
      }
    });

    cancelButton?.addEventListener("click", () => {
      addAudit("Payment cancelled", "User chose not to continue after the safety check.", "safe", "check");
      resetPaymentFlow();
      showToast("Cancelled. Nothing moved.");
      speak("Cancelled. Nothing moved.");
    });

    editButton?.addEventListener("click", () => {
      showTyping();
      dom.commandInput.value = payment.raw;
      dom.commandInput.focus();
      showToast("Edit the request, then send it again.");
      speak("Tell me the corrected amount or payee.");
    });
  };

  const renderProcessing = (payment) => {
    dom.reviewEmpty.classList.add("hidden");
    dom.reviewContent.classList.remove("hidden");
    dom.reviewContent.innerHTML = `
      <div class="processing-view">
        <div>
          <div class="processing-spinner"></div>
          <h2>Sending ${formatCurrency(payment.amount)} in test mode</h2>
          <p>Creating a sandbox payment for ${escapeHTML(payment.payee.name)}. Please keep this window open.</p>
        </div>
      </div>`;
  };

  const renderSuccess = (payment) => {
    const reference = `pay_test_${Math.random().toString(36).slice(2, 10)}`;
    appState.lastPayment = { ...payment, reference };
    dom.reviewEmpty.classList.add("hidden");
    dom.reviewContent.classList.remove("hidden");
    dom.reviewContent.innerHTML = `
      <div class="result-view">
        <div>
          <div class="result-icon"><svg><use href="#icon-check"></use></svg></div>
          <h2>Test payment complete</h2>
          <p>${formatCurrency(payment.amount)} paid to ${escapeHTML(payment.payee.name)}.</p>
          <div class="result-reference">${escapeHTML(reference)} · Razorpay sandbox · ${escapeHTML(timeNow())}</div>
          <div class="result-actions"><button class="primary-button" id="startAnother" type="button">Start another payment</button><button class="secondary-button" id="viewAuditFromResult" type="button">View audit log</button></div>
        </div>
      </div>`;
    byId("startAnother")?.addEventListener("click", resetPaymentFlow);
    byId("viewAuditFromResult")?.addEventListener("click", openAudit);
  };

  const renderBlocked = (payment) => {
    dom.reviewEmpty.classList.add("hidden");
    dom.reviewContent.classList.remove("hidden");
    dom.reviewContent.innerHTML = `
      <div class="result-view">
        <div>
          <div class="result-icon blocked-icon"><svg><use href="#icon-shield"></use></svg></div>
          <h2>Request declined safely</h2>
          <p>${formatCurrency(payment.amount)} stayed in your account. No payment was sent.</p>
          <div class="result-reference">Collect request blocked · ${escapeHTML(timeNow())}</div>
          <div class="result-actions"><button class="primary-button" id="startAnother" type="button">Start another payment</button><button class="secondary-button" id="viewAuditFromResult" type="button">View audit log</button></div>
        </div>
      </div>`;
    byId("startAnother")?.addEventListener("click", resetPaymentFlow);
    byId("viewAuditFromResult")?.addEventListener("click", openAudit);
  };

  const executePayment = (payment) => {
    if (appState.status === "processing") return;
    addAudit("Confirmation received", `User said yes to ${formatCurrency(payment.amount)} for ${payment.payee.name}.`, "safe", "check");
    setState("processing");
    renderProcessing(payment);
    speak(`Confirmed. Sending ${amountInWords(payment.amount)} to ${payment.payee.name} through Razorpay test mode.`);
    window.clearTimeout(appState.processingTimer);
    appState.processingTimer = window.setTimeout(() => {
      addAudit("Payment complete", `${formatCurrency(payment.amount)} test payment sent to ${payment.payee.name}. No real money moved.`, "safe", "check");
      setState("success");
      renderSuccess(payment);
      speak(`Done. ${amountInWords(payment.amount)} paid to ${payment.payee.name}. This was a test payment; no real money moved.`);
      showToast("Test payment complete · nothing real moved");
    }, 1700);
  };

  const declineCollect = (payment) => {
    addAudit("Collect request declined", `${formatCurrency(payment.amount)} request declined. Nothing left the account.`, "danger", "shield");
    setState("blocked");
    renderBlocked(payment);
    speak(`Stop confirmed. The collect request for ${amountInWords(payment.amount)} was declined. Nothing left your account.`);
    showToast("Request declined safely · no money moved");
  };

  const handleCommand = (rawText, source = "voice", demoType = "") => {
    const raw = String(rawText || "").trim();
    if (!raw) return;
    if (["analyzing", "processing"].includes(appState.status)) {
      showToast("I am still finishing the current step.");
      return;
    }
    if (appState.listening && appState.recognition) {
      try { appState.recognition.stop(); } catch (error) { /* no-op */ }
      appState.listening = false;
    }

    appState.pending = null;
    appState.riskAcknowledged = false;
    appState.collectAcknowledged = false;
    appState.analysisToken += 1;
    const token = appState.analysisToken;
    window.clearTimeout(appState.analysisTimer);
    setTranscript(raw);
    setState("analyzing");
    showReviewLoading();
    addAudit(source === "demo" ? "Demo request" : "You said", raw, "safe", "mic");
    speak("I heard that. I am checking the amount, payee, and payment direction now.");

    appState.analysisTimer = window.setTimeout(() => {
      if (token !== appState.analysisToken) return;
      const parsed = parseCommand(raw, demoType);
      appState.pending = parsed;
      const riskDetail = parsed.isCollect
        ? `Collect request detected for ${formatCurrency(parsed.amount)}; it would pull money from the user.`
        : parsed.payee.mismatch || !parsed.payee.trusted
          ? `Payee identity needs attention: requested ${parsed.payee.requestedName || parsed.payee.name}, resolved ${parsed.payee.name}.`
          : parsed.flags.includes("amount")
            ? `${formatCurrency(parsed.amount)} is ${parsed.amountMultiplier}× the usual amount for ${parsed.payee.name}.`
            : `Trusted payee and amount pattern matched for ${parsed.payee.name}.`;
      addAudit("Agent safety check", riskDetail, parsed.riskLevel === "low" ? "safe" : parsed.isCollect ? "danger" : "warning", parsed.isCollect ? "alert" : parsed.riskLevel === "low" ? "shield" : "alert");
      renderReview(parsed);
      setState(parsed.riskLevel === "low" ? "review" : "guard");
      speak(buildSpokenSummary(parsed));
    }, 780);
  };

  const buildSpokenSummary = (payment) => {
    if (payment.isCollect) {
      return `Stop. This is a collect request for ${payment.amountWords} rupees. It would take money from you, not pay the shop. Say no if you did not expect it.`;
    }
    if (payment.payee.mismatch || !payment.payee.trusted) {
      return `Pause. You asked for ${payment.payee.requestedName || payment.payee.name}, but I found an account named ${payment.payee.name}. This may be the wrong payee. Please verify before continuing.`;
    }
    if (payment.flags.includes("amount")) {
      return `You are about to pay ${payment.amountWords} rupees to ${payment.payee.name}. That is ${payment.amountMultiplier} times your usual amount for this payee. Please verify it before continuing.`;
    }
    return `You are about to pay ${payment.amountWords} rupees to ${payment.payee.name}, your regular grocery shop. Say yes to confirm.`;
  };

  const resetPaymentFlow = () => {
    window.clearTimeout(appState.analysisTimer);
    window.clearTimeout(appState.processingTimer);
    appState.analysisToken += 1;
    appState.pending = null;
    appState.lastPayment = null;
    appState.riskAcknowledged = false;
    appState.collectAcknowledged = false;
    setState("ready");
    setTranscript('Sharma kirana ko paanch sau rupaye bhejo');
    dom.reviewContent.classList.add("hidden");
    dom.reviewContent.innerHTML = "";
    dom.reviewEmpty.classList.remove("hidden");
  };

  const showTyping = () => {
    dom.typedForm.classList.remove("hidden");
    dom.typeButton.classList.add("hidden");
    dom.commandInput.focus();
  };

  const hideTyping = () => {
    dom.typedForm.classList.add("hidden");
    dom.typeButton.classList.remove("hidden");
  };

  const setupRecognition = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      appState.listening = true;
      setState("listening");
      setTranscript("Listening…");
    };
    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const phrase = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalText += phrase;
        else interim += phrase;
      }
      if (interim) setTranscript(interim);
      if (finalText.trim()) {
        appState.listening = false;
        handleCommand(finalText.trim(), "voice");
      }
    };
    recognition.onerror = (event) => {
      appState.listening = false;
      setState("ready");
      const message = event.error === "not-allowed" ? "Microphone permission is off. You can type the command instead." : "I could not hear that. Try again or type a command.";
      showToast(message, event.error === "not-allowed" ? "danger" : "safe");
      if (event.error === "not-allowed") showTyping();
    };
    recognition.onend = () => {
      if (appState.listening) {
        appState.listening = false;
        setState("ready");
      }
    };
    appState.recognition = recognition;
  };

  const startOrStopListening = () => {
    if (["analyzing", "processing"].includes(appState.status)) return;
    if (!appState.recognition) {
      showTyping();
      showToast("Microphone is unavailable here — type a command instead.");
      return;
    }
    if (appState.listening) {
      appState.listening = false;
      try { appState.recognition.stop(); } catch (error) { /* no-op */ }
      setState("ready");
      return;
    }
    try {
      appState.recognition.lang = dom.languageSelect?.value || "en-IN";
      appState.recognition.start();
    } catch (error) {
      showToast("Microphone is busy. Try again in a moment.", "danger");
    }
  };

  const openAudit = () => {
    renderAudit();
    dom.auditModal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    byId("closeAudit")?.focus();
  };

  const closeAudit = () => {
    dom.auditModal.classList.add("hidden");
    document.body.classList.remove("modal-open");
  };

  const openInfo = (type = "how") => {
    const info = {
      how: {
        kicker: "HOW IT WORKS",
        title: "A safer way to say “pay”",
        body: `<p>AwaazPay does not blindly press Pay. It translates your words into a payment intent, checks that intent against your saved payees and spending patterns, and speaks the decision back to you.</p><div class="info-points"><div><span>1</span><strong>Say it naturally</strong><small>Hindi, English, or Hinglish phrases are welcome.</small></div><div><span>2</span><strong>Hear the truth</strong><small>Amount, payee, direction, and risk are spoken plainly.</small></div><div><span>3</span><strong>Choose deliberately</strong><small>No confirmation means no payment.</small></div></div>`,
      },
      safety: {
        kicker: "SAFETY CENTRE",
        title: "Three rules protect every payment",
        body: `<p>These guardrails are deliberately simple so the person making the payment, and the caregiver reviewing it later, can understand what happened.</p><div class="info-points"><div><span>01</span><strong>Always repeat the truth</strong><small>The amount and destination are spoken back before a confirmation can be accepted.</small></div><div><span>02</span><strong>Pause on unusual signals</strong><small>A large amount, a new payee, or a name mismatch needs an extra acknowledgement.</small></div><div><span>03</span><strong>Explain pulls clearly</strong><small>A collect request is described as money leaving your account, never as a normal payment.</small></div></div>`,
      },
      settings: {
        kicker: "PREFERENCES",
        title: "Voice that works for you",
        body: `<p>The demo supports browser speech recognition where available. Choose a language above the microphone and use the type fallback whenever the environment cannot access a microphone.</p><div class="info-points"><div><span>EN</span><strong>English · India</strong><small>Good for English commands and spoken confirmations.</small></div><div><span>हि</span><strong>हिन्दी / Hinglish</strong><small>Set the voice language to Hindi for browser speech services that support it.</small></div><div><span>⌨</span><strong>Type instead</strong><small>Every voice flow has a keyboard-accessible fallback.</small></div></div>`,
      },
    }[type] || {};
    dom.infoKicker.textContent = info.kicker;
    dom.infoTitle.textContent = info.title;
    dom.infoBody.innerHTML = info.body;
    dom.infoModal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    byId("closeInfo")?.focus();
  };

  const closeInfo = () => {
    dom.infoModal.classList.add("hidden");
    document.body.classList.remove("modal-open");
  };

  // Primary voice controls.
  dom.speakButton.addEventListener("click", startOrStopListening);
  dom.micButton.addEventListener("click", startOrStopListening);
  dom.typeButton.addEventListener("click", showTyping);
  dom.closeTyping.addEventListener("click", hideTyping);
  dom.typedForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = dom.commandInput.value.trim();
    if (!value) {
      dom.commandInput.focus();
      return;
    }
    handleCommand(value, "typed");
    dom.commandInput.value = "";
    hideTyping();
  });

  dom.languageSelect?.addEventListener("change", () => {
    if (appState.recognition) appState.recognition.lang = dom.languageSelect.value;
    showToast(`Voice language set to ${dom.languageSelect.options[dom.languageSelect.selectedIndex].text}`);
  });

  // One-click judge-friendly scenarios.
  $$("[data-demo]").forEach((button) => {
    button.addEventListener("click", () => {
      const demoType = button.dataset.demo;
      button.classList.add("is-running");
      window.setTimeout(() => button.classList.remove("is-running"), 650);
      handleCommand(demoPhrases[demoType], "demo", demoType);
    });
  });

  // Navigation doubles as a compact demo tour on smaller builds.
  $$("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      $$("[data-nav]").forEach((item) => {
        item.classList.toggle("active", item === button);
        if (item === button) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
      const destination = button.dataset.nav;
      if (destination === "activity") openAudit();
      else if (destination === "safety") openInfo("safety");
      else if (destination === "settings") openInfo("settings");
      else byId("voiceWorkspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  byId("auditButton")?.addEventListener("click", openAudit);
  byId("openAudit")?.addEventListener("click", openAudit);
  byId("closeAudit")?.addEventListener("click", closeAudit);
  byId("closeAuditBottom")?.addEventListener("click", closeAudit);
  byId("clearAudit")?.addEventListener("click", () => {
    appState.audit = [];
    renderAudit();
    showToast("Session log cleared");
  });
  dom.auditModal.addEventListener("click", (event) => {
    if (event.target === dom.auditModal) closeAudit();
  });

  byId("helpButton")?.addEventListener("click", () => openInfo("how"));
  byId("safetyInfoButton")?.addEventListener("click", () => openInfo("safety"));
  byId("openSafety")?.addEventListener("click", () => openInfo("safety"));
  byId("loopLearnButton")?.addEventListener("click", () => openInfo("how"));
  byId("closeInfo")?.addEventListener("click", closeInfo);
  byId("closeInfoBottom")?.addEventListener("click", closeInfo);
  dom.infoModal.addEventListener("click", (event) => {
    if (event.target === dom.infoModal) closeInfo();
  });
  $(".profile-menu")?.addEventListener("click", () => showToast("Profile controls are outside this demo."));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAudit();
      closeInfo();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "1") {
      event.preventDefault();
      byId("voiceWorkspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (event.code === "Space" && !event.repeat && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      startOrStopListening();
    }
  });

  setupRecognition();
  renderAudit();
  setState("ready");
})();
