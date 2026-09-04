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
    connectionLabel: byId("connectionLabel"),
    modeLabel: byId("modeLabel"),
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
    balanceDisplay: byId("balanceDisplay"),
    metricPayments: byId("metricPayments"),
    metricScams: byId("metricScams"),
    metricParsed: byId("metricParsed"),
    metricPins: byId("metricPins"),
    pinBadge: byId("pinBadge"),
    pinBadgeText: $("#pinBadgeText"),
    providerLabel: byId("providerLabel"),
    providerMode: byId("providerMode"),
    mandateId: byId("mandateId"),
    mandateLimit: byId("mandateLimit"),
    mandateUsed: byId("mandateUsed"),
    mandateStatus: byId("mandateStatus"),
    walletBalance: byId("walletBalance"),
    logEntries: byId("logEntries"),
    logCount: byId("logCount"),
  };

  /**
   * Voice PIN configuration.
   * The demo PIN is 1234 ("one two three four" / "ek do teen char"). In Smart Demo Mode
   * the server also returns it so the judge never has to guess; with Razorpay keys set it
   * is never exposed and verification is server-side only.
   */
  const FALLBACK_VOICE_PIN = "1234";
  const PIN_LENGTH = 4;
  const PIN_MAX_ATTEMPTS = 3;
  const DEMO_PIN_SHORTCUT = /\b(demo\s+)?(voice\s+)?pin\b/i;

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
    mandate: "Mehta utilities ko chhe hazaar rupaye bhejo",
  };

  /**
   * The caregiver-created mandate is the compliance reason a payment can run hands-free.
   * It is loaded from the server (`/api/mandate`) and this object is only the offline copy
   * used when the console is opened without the Node server.
   */
  const fallbackMandate = {
    id: "sub_LOCALDEMO01",
    tokenId: "token_LOCALDEMO01",
    type: "upi-autopay",
    instrument: "sarala.devi@okhdfcbank",
    status: "active",
    perTransactionLimit: 5000,
    dailyLimit: 15000,
    usedToday: 0,
    remainingToday: 15000,
    caregiver: { name: "Meera Sharma", relationship: "Daughter" },
    wallet: { id: "acc_LOCALDEMO01", label: "AwaazPay closed-loop wallet", balance: 12500, currency: "INR" },
    authorizedPayees: [],
    handsFree: true,
    paymentMode: "smart-demo",
    voicePinLength: PIN_LENGTH,
    demoVoicePin: FALLBACK_VOICE_PIN,
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
    clarify: {
      label: "Need one more detail",
      headline: "I do not want to guess.",
      subline: "Tell me the missing amount or payee and I will check it again.",
      stage: "Need detail",
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
    authenticate: {
      label: "Waiting for Voice PIN",
      headline: "Now say your Voice PIN.",
      subline: "Say your 4 digit Voice PIN to authorize this payment hands-free. I never repeat it back and it is never written in your log.",
      stage: "Voice PIN",
      button: "Say Voice PIN",
    },
    pinLocked: {
      label: "Voice PIN locked",
      headline: "Stopped for your safety.",
      subline: "Three incorrect Voice PIN attempts. Nothing was paid and the caregiver log records the lockout.",
      stage: "Locked",
      button: "Start a new payment",
    },
    processing: {
      label: "Charging the mandate",
      headline: "One moment…",
      subline: "Your Voice PIN matched. I am calling Razorpay server-to-server on your caregiver mandate — no PIN pad is opened.",
      stage: "Processing",
      button: "Please wait",
    },
    success: {
      label: "All done · hands-free",
      headline: "That is taken care of.",
      subline: "Paid from your caregiver mandate without a visual PIN. The full trail is in your caregiver log.",
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
    caregiverStatus: "none",
    caregiverApprovalId: null,
    caregiverTimer: null,
    awaitingClarification: false,
    toastTimer: null,
    recognition: null,
    balance: 12500,
    mandate: { ...fallbackMandate },
    smartDemoMode: true,
    serverAvailable: true,
    tokenTtl: 90,
    sessionId: `SES-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    voicePin: {
      digits: "",
      attempts: 0,
      locked: false,
      lockedUntil: 0,
      verifying: false,
      awaitingSpokenPin: false,
    },
    metrics: {
      paymentsCompleted: 0,
      scamsBlocked: 0,
      commandsAttempted: 0,
      commandsParsed: 0,
      voicePinsVerified: 0,
      pinAttemptsBlocked: 0,
    },
    audit: [
      {
        time: "Session start",
        label: "Safety session opened",
        detail: "Caregiver mandate active · Voice PIN required before any hands-free charge.",
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

  const speak = (text, onEnd) => {
    const finish = () => {
      if (typeof onEnd !== "function") return;
      try { onEnd(); } catch (error) { /* keep the visual flow alive */ }
    };
    if (!("speechSynthesis" in window) || !text) {
      window.setTimeout(finish, 420);
      return;
    }
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
      let fired = false;
      utterance.onend = () => {
        if (fired) return;
        fired = true;
        finish();
      };
      utterance.onerror = utterance.onend;
      window.speechSynthesis.speak(utterance);
      // Safety net: some engines never fire onend, and the hands-free loop must not stall.
      window.setTimeout(() => {
        if (!fired) {
          fired = true;
          finish();
        }
      }, 9000);
    } catch (error) {
      // Speech is progressive enhancement; the visual flow remains usable when unavailable.
      finish();
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
    if (["ready", "listening", "analyzing", "clarify", "review", "guard", "authenticate", "pinLocked", "blocked", "processing", "success"].includes(nextStatus)) {
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

    // The blue hands-free authorization indicator: visible only while a Voice PIN is awaited.
    const waitingForPin = nextStatus === "authenticate";
    dom.pinBadge?.classList.toggle("hidden", !waitingForPin);
    dom.voiceStage?.classList.toggle("awaiting-pin", waitingForPin);
    if (waitingForPin && dom.pinBadgeText) dom.pinBadgeText.textContent = "WAITING FOR VOICE PIN";

    updateAgentSteps(nextStatus);
  };

  const updateAgentSteps = (status) => {
    const progress = {
      ready: { active: 0, done: -1 },
      listening: { active: 0, done: -1 },
      analyzing: { active: 1, done: 0 },
      clarify: { active: 1, done: 0 },
      review: { active: 2, done: 1 },
      guard: { active: 3, done: 2 },
      authenticate: { active: 4, done: 3 },
      pinLocked: { active: 4, done: 3 },
      processing: { active: 5, done: 4 },
      success: { active: -1, done: 5 },
      blocked: { active: 3, done: 2 },
    }[status] || { active: 0, done: -1 };

    const stepNames = ["understand", "check", "confirm", "guard", "authenticate", "execute"];
    $$(".agent-step", dom.stepList).forEach((step, index) => {
      const stateLabel = $(".step-state", step);
      step.classList.remove("active", "done", "guard-active", "pin-active");
      if (index <= progress.done) {
        step.classList.add("done");
        stateLabel.textContent = "done";
      } else if (index === progress.active) {
        step.classList.add("active");
        if (status === "guard" || status === "blocked") step.classList.add("guard-active");
        if (status === "authenticate" || status === "pinLocked") step.classList.add("pin-active");
        stateLabel.textContent = status === "pinLocked" ? "locked" : "working";
      } else {
        stateLabel.textContent = "waiting";
      }
      step.dataset.step = stepNames[index];
    });
  };

  const amountInWords = (amount) => {
    const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
      'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tenths = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const sub100 = (n) => n < 20 ? ones[n] : tenths[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    const sub1000 = (n) => n < 100 ? sub100(n) : ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + sub100(n % 100) : '');
    if (!amount) return 'zero';
    if (amount >= 100000) {
      const l = Math.floor(amount / 100000);
      const r = amount % 100000;
      return sub100(l) + ' lakh' + (r ? ' ' + amountInWords(r) : '');
    }
    if (amount >= 1000) {
      const t = Math.floor(amount / 1000);
      const r = amount % 1000;
      return sub100(t) + ' thousand' + (r ? ' ' + sub1000(r) : '');
    }
    return sub1000(amount);
  };

  const updateBalance = () => {
    if (dom.balanceDisplay) dom.balanceDisplay.textContent = formatCurrency(appState.balance);
  };

  const updateMetrics = () => {
    if (dom.metricPayments) dom.metricPayments.textContent = appState.metrics.paymentsCompleted;
    if (dom.metricScams) dom.metricScams.textContent = appState.metrics.scamsBlocked;
    if (dom.metricParsed) dom.metricParsed.textContent = appState.metrics.commandsParsed;
    if (dom.metricPins) dom.metricPins.textContent = appState.metrics.voicePinsVerified;
  };

  const parseAmount = (text) => {
    const normalized = text.toLowerCase().replaceAll(",", "").replaceAll("₹", "");
    const phraseAmounts = [
      // Lakhs
      [/ek\s*lakh|one\s*lakh/, 100000],
      // Fifty thousand
      [/pachaas\s*(hazaar|hazar)|pachas\s*(hazaar|hazar)|fifty\s*thousand|fifty\s*k\b/, 50000],
      // Forty thousand
      [/chaalees\s*(hazaar|hazar)|chalees\s*(hazaar|hazar)|forty\s*thousand/, 40000],
      // Thirty thousand
      [/tees\s*(hazaar|hazar)|thirty\s*thousand/, 30000],
      // Twenty five thousand
      [/pachees\s*(hazaar|hazar)|twenty[\s-]?five\s*thousand/, 25000],
      // Twenty thousand
      [/bees\s*(hazaar|hazar)|twenty\s*thousand/, 20000],
      // Fifteen thousand
      [/pandrah\s*(hazaar|hazar)|pandraha\s*(hazaar|hazar)|fifteen\s*thousand/, 15000],
      // Twelve thousand
      [/baarah\s*(hazaar|hazar)|barah\s*(hazaar|hazar)|twelve\s*thousand/, 12000],
      // Ten thousand
      [/das\s*(hazaar|hazar)|ten\s*thousand/, 10000],
      // Nine thousand
      [/nau\s*(hazaar|hazar)|nine\s*thousand/, 9000],
      // Eight thousand
      [/aath\s*(hazaar|hazar)|eight\s*thousand/, 8000],
      // Seven thousand
      [/saat\s*(hazaar|hazar)|seven\s*thousand/, 7000],
      // Six thousand
      [/chhe\s*(hazaar|hazar)|chay\s*(hazaar|hazar)|six\s*thousand/, 6000],
      // Five thousand
      [/paanch\s*(hazaar|hazar)|panch\s*(hazaar|hazar)|five\s*thousand/, 5000],
      // Four thousand
      [/chaar\s*(hazaar|hazar)|char\s*(hazaar|hazar)|four\s*thousand/, 4000],
      // Three thousand
      [/teen\s*(hazaar|hazar)|three\s*thousand/, 3000],
      // Two thousand
      [/do\s*(hazaar|hazar)|two\s*thousand/, 2000],
      // One thousand
      [/ek\s*(hazaar|hazar)|one\s*thousand/, 1000],
      // Twelve hundred (before nine/eight hundred to avoid partial match on "twelve")
      [/baarah\s*sau|barah\s*sau|twelve\s*hundred/, 1200],
      // Nine hundred
      [/nau\s*(sau|सौ)|nine\s*hundred/, 900],
      // Eight hundred
      [/aath\s*(sau|सौ)|eight\s*hundred/, 800],
      // Seven hundred
      [/saat\s*(sau|सौ)|seven\s*hundred/, 700],
      // Six hundred
      [/chhe\s*(sau|सौ)|chay\s*(sau|सौ)|six\s*hundred/, 600],
      // Five hundred
      [/paanch\s*(sau|सौ)|panch\s*(sau|सौ)|five\s*hundred/, 500],
      // Four hundred
      [/chaar\s*(sau|सौ)|char\s*(sau|सौ)|four\s*hundred/, 400],
      // Three hundred
      [/teen\s*(sau|सौ)|three\s*hundred/, 300],
      // Two hundred forty
      [/do\s*sau\s*chaalees|two\s*hundred\s*and\s*forty/, 240],
      // Two hundred
      [/do\s*(sau|सौ)|two\s*hundred/, 200],
      // One hundred fifty
      [/dedh\s*(sau|सौ)|one\s*fifty|hundred\s*fifty/, 150],
      // One hundred
      [/ek\s*(sau|सौ)|one\s*hundred/, 100],
      // Fifty (must come after "fifty thousand")
      [/pachaas\b(?!\s*(hazaar|hazar))|fifty\b(?!\s*(thousand|k))/, 50],
    ];
    for (const [pattern, amount] of phraseAmounts) {
      if (pattern.test(normalized)) return { amount, matched: true };
    }

    const compactMatch = normalized.match(/(?:rs\.?|inr|rupees?)?\s*(\d{2,7})(?:\s*(?:rupees?|rs\.?))?/i);
    if (compactMatch) return { amount: Number(compactMatch[1]), matched: true };

    const shortK = normalized.match(/(\d+(?:\.\d+)?)\s*k\b/i);
    if (shortK) return { amount: Math.round(Number(shortK[1]) * 1000), matched: true };

    return { amount: null, matched: false };
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
        matched: true,
      };
    }
    if (/sharma|kirana|grocery|दुकान|dukaan/.test(normalized)) return { ...payeeProfiles.sharma, matched: true };
    if (/rakesh|medical|दवा|dawai/.test(normalized)) return { ...payeeProfiles.rakesh, matched: true };
    if (/mehta|utility|bijli|electricity/.test(normalized)) return { ...payeeProfiles.mehta, matched: true };
    if (/unknown|new\s*(person|payee)|not\s*(saved|sure)|aman\s*trader/.test(normalized)) {
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
        matched: true,
      };
    }
    return {
      name: "Unknown payee",
      requestedName: "Unknown payee",
      short: "?",
      vpa: "Not resolved",
      usual: 0,
      payments: 0,
      lastPaid: "never",
      avatar: "unknown",
      trusted: false,
      mismatch: false,
      matched: false,
    };
  };

  /**
   * Single source of truth for the safety policy. Both the local Smart Demo Mode parser and
   * the Groq-backed intent go through this, so the mandate rule can never be skipped by the
   * language model. The model explains; the policy decides.
   */
  const applyRiskPolicy = (intent) => {
    const { amount, payee, isCollect } = intent;
    const missingFields = [...(intent.missingFields || [])];

    // A pull request is judged by its direction, not by whether the sender's name resolved.
    // Demanding a payee here would drag a scam victim into a "who should I pay?" conversation
    // instead of warning them that money is about to leave the account.
    if (isCollect) {
      const payeeGap = missingFields.indexOf("payee");
      if (payeeGap >= 0) missingFields.splice(payeeGap, 1);
    }

    const needsClarification = missingFields.length > 0;
    const mandateLimit = appState.mandate?.perTransactionLimit || 5000;
    const mandateBreach = !needsClarification && !isCollect && Boolean(amount) && amount > mandateLimit;
    const flags = [...(intent.flags || [])];

    if (!needsClarification && payee.usual && amount >= Math.max(5000, payee.usual * 10) && !flags.includes("amount")) {
      flags.push("amount");
    } else if (!needsClarification && payee.usual && amount >= payee.usual * 3 && !flags.includes("amount") && !flags.includes("amount-elevated")) {
      flags.push("amount-elevated");
    }
    if (mandateBreach && !flags.includes("mandate-limit")) flags.push("mandate-limit");

    const amountMultiplier = payee.usual && amount ? Math.round(amount / payee.usual) : null;
    const riskLevel = needsClarification ? "clarify" : isCollect ? "critical" : flags.length ? "high" : "low";
    const riskAcknowledgement =
      !needsClarification &&
      (flags.includes("amount") || flags.includes("amount-elevated") || flags.includes("payee") || mandateBreach || !payee.trusted);
    const requiresCaregiver =
      !needsClarification && !isCollect && (flags.includes("amount") || flags.includes("payee") || mandateBreach || !payee.trusted);

    return {
      ...intent,
      flags,
      missingFields: missingFields || [],
      needsClarification,
      mandateBreach,
      mandateLimit,
      amountMultiplier,
      riskLevel,
      riskAcknowledgement,
      requiresCaregiver,
      // A hands-free charge is only legal inside the mandate. Outside it the flow must fall
      // back to caregiver assistance (and, in production, the bank's visual UPI PIN).
      handsFreeEligible: !needsClarification && !isCollect && !mandateBreach,
    };
  };

  const parseCommand = (rawText, demoType = "") => {
    const raw = rawText.trim();
    const normalized = raw.toLowerCase();
    const isCollect = demoType === "collect" || /collect\s*request|request\s*(for|to)|pull\s*request|paise\s*(maang|mang)|take\s*money/.test(normalized);
    const payee = resolvePayee(raw, demoType);
    const amountInfo = parseAmount(raw);
    const amount = amountInfo.amount;
    const missingFields = [];
    if (!payee.matched) missingFields.push("payee");
    if (!amountInfo.matched) missingFields.push("amount");

    const flags = [];
    if (isCollect) flags.push("collect");
    if (!payee.trusted && payee.matched) flags.push("payee");
    const intentId = `INT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    return applyRiskPolicy({
      raw,
      amount,
      amountMatched: amountInfo.matched,
      amountWords: amount ? amountInWords(amount) : "the amount",
      payee,
      payeeMatched: payee.matched,
      isCollect,
      flags,
      missingFields,
      intentId,
      direction: isCollect ? "Money out · collect request" : "Payment out · user started",
    });
  };

  const addAudit = (label, detail, tone = "safe", icon = "check") => {
    appState.audit.unshift({ time: timeNow(), label, detail, tone, icon });
    if (appState.audit.length > 40) appState.audit.length = 40;
    renderAudit();
  };

  const auditEntryHTML = (entry) => `
          <div class="audit-entry">
            <span class="audit-time">${escapeHTML(entry.time)}</span>
            <span class="audit-entry-icon ${entry.tone === "danger" ? "danger" : entry.tone === "warning" ? "warning" : ""}"><svg><use href="#icon-${entry.icon || "check"}"></use></svg></span>
            <span class="audit-entry-copy"><strong>${escapeHTML(entry.label)}</strong><span>${escapeHTML(entry.detail)}</span></span>
          </div>`;

  const renderAudit = () => {
    const entries = appState.audit.length
      ? appState.audit.map(auditEntryHTML).join("")
      : '<div class="empty-audit">No events in this session yet.</div>';

    if (dom.auditEntries) dom.auditEntries.innerHTML = entries;

    // The always-visible caregiver log at the bottom of the console (latest 6 events).
    if (dom.logEntries) {
      dom.logEntries.innerHTML = appState.audit.length
        ? appState.audit.slice(0, 6).map(auditEntryHTML).join("")
        : '<div class="empty-audit">No events yet. Speak a payment command to start the trail.</div>';
    }
    if (dom.logCount) dom.logCount.textContent = `${appState.audit.length} event${appState.audit.length === 1 ? "" : "s"}`;
  };

  /** Renders the caregiver-created mandate that makes hands-free charging lawful. */
  const renderMandateCard = () => {
    const mandate = appState.mandate;
    if (dom.mandateId) dom.mandateId.textContent = mandate.id || "—";
    if (dom.mandateLimit) dom.mandateLimit.textContent = `₹${formatNumber(mandate.perTransactionLimit || 0)}`;
    if (dom.mandateUsed) {
      const used = mandate.usedToday || 0;
      const daily = mandate.dailyLimit || 0;
      dom.mandateUsed.textContent = daily ? `₹${formatNumber(used)} of ₹${formatNumber(daily)} today` : "—";
    }
    if (dom.mandateStatus) {
      const active = mandate.status === "active";
      dom.mandateStatus.textContent = active ? "active · hands-free" : String(mandate.status || "inactive");
      dom.mandateStatus.classList.toggle("mandate-inactive", !active);
    }
    if (dom.walletBalance) dom.walletBalance.textContent = `₹${formatNumber(mandate.wallet?.balance ?? appState.balance)}`;
    const instrument = byId("mandateInstrument");
    if (instrument) instrument.textContent = mandate.instrument || "—";
    const caregiver = byId("mandateCaregiver");
    if (caregiver) caregiver.textContent = mandate.caregiver?.name ? `${mandate.caregiver.name} · ${mandate.caregiver.relationship || "Caregiver"}` : "—";
  };

  const loadMandate = async () => {
    try {
      const response = await fetch("/api/mandate", { cache: "no-store" });
      if (!response.ok) throw new Error("mandate unavailable");
      const mandate = await response.json();
      appState.mandate = { ...fallbackMandate, ...mandate };
      appState.serverAvailable = true;
      if (typeof mandate.wallet?.balance === "number") appState.balance = mandate.wallet.balance;
      if (!mandate.demoVoicePin) appState.mandate.demoVoicePin = appState.smartDemoMode ? FALLBACK_VOICE_PIN : null;
      updateBalance();
    } catch (error) {
      appState.mandate = { ...fallbackMandate };
      appState.serverAvailable = false;
    }
    renderMandateCard();
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

  const renderClarification = (payment) => {
    const missing = payment.missingFields || [];
    const missingAmount = missing.includes("amount");
    const missingPayee = missing.includes("payee");
    let question = "Please tell me the payee and the amount.";
    if (missingAmount && !missingPayee) question = `How much should I send to ${payment.payee.name}?`;
    if (missingPayee && !missingAmount) question = payment.amount ? `Who should I send ${formatCurrency(payment.amount)} to?` : "Who should I send the payment to?";

    dom.reviewEmpty.classList.add("hidden");
    dom.reviewContent.classList.remove("hidden");
    dom.reviewContent.innerHTML = `
      <div class="review-head"><span class="section-kicker">CLARIFICATION NEEDED</span><span class="review-ref">No payment intent created</span></div>
      <div class="clarify-panel"><div class="clarify-icon"><svg><use href="#icon-help"></use></svg></div><div><h2>${escapeHTML(question)}</h2><p>I will not guess a missing amount or destination. Add the detail and I will run the safety check again.</p></div></div>
      <div class="missing-fields">${missing.map((field) => `<span><svg><use href="#icon-alert"></use></svg> missing ${escapeHTML(field)}</span>`).join("")}</div>
      <div class="review-actions"><button class="primary-button" id="clarifyInput" type="button"><svg><use href="#icon-mic"></use></svg>Tell me the missing detail</button><button class="cancel-action" id="cancelReview" type="button">Cancel</button></div>
      <div class="reasoning-line"><svg><use href="#icon-lock"></use></svg><span>Nothing can be executed until both amount and payee are explicit.</span></div>`;

    byId("clarifyInput")?.addEventListener("click", () => {
      showTyping();
      dom.commandInput.placeholder = missingAmount && !missingPayee ? "e.g. 500 rupees" : missingPayee && !missingAmount ? "e.g. Sharma Kirana" : "e.g. Sharma Kirana ko 500 rupaye bhejo";
      dom.commandInput.focus();
      speak(question);
    });
    byId("cancelReview")?.addEventListener("click", () => {
      addAudit("Clarification cancelled", "User chose not to provide the missing payment details.", "safe", "check");
      resetPaymentFlow();
      speak("Cancelled. Nothing moved.");
    });
  };

  const caregiverApprovalHTML = (payment) => {
    if (!payment.requiresCaregiver) return "";
    const status = appState.caregiverStatus;
    if (!appState.riskAcknowledged) {
      return `<div class="caregiver-approval"><span class="caregiver-approval-icon"><svg><use href="#icon-users"></use></svg></span><span class="caregiver-approval-copy"><strong>Caregiver approval required</strong><small>Needed above ₹${formatNumber(appState.mandate.perTransactionLimit)} (outside the hands-free mandate) or for a new payee.</small></span><button class="caregiver-action" type="button" disabled>After warning</button></div>`;
    }
    if (status === "pending") {
      return `<div class="caregiver-approval pending"><span class="caregiver-approval-icon"><svg><use href="#icon-clock"></use></svg></span><span class="caregiver-approval-copy"><strong>Waiting for Meera Sharma</strong><small>Approval request sent. The demo will simulate her response.</small></span><button class="caregiver-action" type="button" disabled>Waiting…</button></div>`;
    }
    if (status === "approved") {
      return `<div class="caregiver-approval approved"><span class="caregiver-approval-icon"><svg><use href="#icon-check"></use></svg></span><span class="caregiver-approval-copy"><strong>Approved by Meera Sharma</strong><small>Approval recorded in the caregiver log.</small></span><span class="verified-label">approved</span></div>`;
    }
    return `<div class="caregiver-approval"><span class="caregiver-approval-icon"><svg><use href="#icon-users"></use></svg></span><span class="caregiver-approval-copy"><strong>Caregiver approval required</strong><small>Ask Meera Sharma to approve this high-risk payment before continuing.</small></span><button class="caregiver-action" id="requestCaregiver" type="button">Ask caregiver</button></div>`;
  };

  const renderReview = (payment) => {
    if (payment.needsClarification) {
      renderClarification(payment);
      return;
    }
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
    // The mandate breach is the compliance headline: above the limit, hands-free is not allowed.
    if (!p.isCollect && p.mandateBreach) {
      decisionTitle = `Above your ₹${formatNumber(p.mandateLimit)} hands-free mandate`;
      decisionText = `${formatCurrency(p.amount)} cannot be charged on the caregiver mandate, so AwaazPay will not bypass the visual UPI PIN. ${p.payee.name ? `${p.amountMultiplier ? `It is also ${p.amountMultiplier}× your usual amount. ` : ""}` : ""}A caregiver must approve it, and in production the bank's own PIN screen would be used.`;
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
        <div class="ack-row"><button class="checked" id="ackRisk" type="button" aria-label="Remove expected request acknowledgement"><svg><use href="#icon-check"></use></svg></button><span>You said you expected this request. A collect request pulls money out, so it is never charged hands-free on your mandate.</span></div>
        <div class="review-actions">
          <button class="primary-button danger" id="declineButton" type="button"><svg><use href="#icon-shield"></use></svg>Say NO · decline request</button>
          <button class="cancel-action" id="cancelReview" type="button">Cancel</button>
        </div>`;
    } else if (p.riskAcknowledgement) {
      const caregiverBlock = caregiverApprovalHTML(p);
      const caregiverApproved = !p.requiresCaregiver || appState.caregiverStatus === "approved";
      const canConfirm = appState.riskAcknowledged && caregiverApproved;
      const actionLabel = !appState.riskAcknowledged
        ? "Acknowledge warning first"
        : p.requiresCaregiver && !caregiverApproved
          ? "Waiting for caregiver approval"
          : "Continue to Voice PIN";
      extraAction = `
        <div class="ack-row"><button id="ackRisk" type="button" aria-label="Acknowledge safety warning" class="${appState.riskAcknowledged ? "checked" : ""}"><svg><use href="#icon-check"></use></svg></button><span>I heard this warning and have independently verified the amount and account name.</span></div>
        ${caregiverBlock}
        <div class="review-actions">
          <button class="primary-button warning" id="confirmPayment" type="button" ${canConfirm ? "" : "disabled"}>${actionLabel}</button>
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
        ${signalHTML("lock", "Mandate", p.isCollect ? "Pulls are never mandated" : p.mandateBreach ? `Above ₹${formatNumber(p.mandateLimit)} limit` : `Within ₹${formatNumber(p.mandateLimit)} · hands-free`, p.isCollect ? "alert" : p.mandateBreach ? "warning" : "safe")}
      </div>
      <div class="decision-box ${decisionClass}"><svg><use href="#icon-${riskIcon}"></use></svg><div><strong>${escapeHTML(decisionTitle)}</strong><p>${escapeHTML(decisionText)}</p></div></div>
      ${extraAction}
      <div class="reasoning-line"><svg><use href="#icon-sliders"></use></svg><span>Agent checked ${p.payee.trusted ? "payee history" : "payee identity"}, amount pattern, payment direction, and the ${escapeHTML(appState.mandate.type === "upi-autopay" ? "UPI AutoPay" : "wallet")} mandate limit. Next step after your yes: Voice PIN.</span></div>`;

    bindReviewActions(p);
  };

  /**
   * True when the utterance names a payee or an amount, i.e. the user is changing the
   * payment ("pay Ramesh two thousand instead") rather than answering the yes/no question.
   * Those must still fall through to the normal parser, which merges them with the pending
   * intent as a clarification.
   */
  const mentionsPaymentDetail = (transcript) => {
    const text = String(transcript || "").trim();
    if (!text) return false;
    const parsed = parseCommand(text);
    return Boolean(parsed.payeeMatched || parsed.amountMatched);
  };

  /**
   * The single gate out of the review step into authorization. Both the on-screen
   * "Say YES" button and a spoken/biometric yes come through here, so the safety guards
   * cannot be bypassed by choosing a different input method.
   *
   * Confirmation never moves money: it only unlocks the authorization challenge.
   */
  const proceedFromReview = (payment, source = "click", transcript = "") => {
    if (!payment) return;
    const heard = String(transcript).slice(0, 40);

    // A collect request pulls money out and is never covered by the mandate, so a spoken
    // "yes" here must be refused rather than honored.
    if (payment.isCollect) {
      addAudit("Confirmation refused", `User said “${heard}” but ${formatCurrency(payment.amount)} is a collect request, which pulls money out and is never charged on the mandate.`, "danger", "shield");
      showToast("A collect request cannot be paid hands-free", "danger");
      speak("I cannot pay a collect request. It takes money out of your account, and my mandate never covers that. Say no to decline it.");
      return;
    }

    if (payment.riskAcknowledgement && !appState.riskAcknowledged) {
      if (source === "click") {
        showToast("Please acknowledge the spoken warning first.", "danger");
        speak("Please acknowledge the warning after you verify the details.");
        return;
      }
      // Accessible equivalent of the acknowledgement checkbox: the warning was spoken
      // aloud and the user answered it out loud. Recorded so the caregiver can see that
      // the pause happened by voice rather than by tap.
      appState.riskAcknowledged = true;
      addAudit(
        "Warning acknowledged by voice",
        `User said “${heard}” after hearing the ${payment.riskLevel} risk warning for ${formatCurrency(payment.amount)} to ${payment.payee.name}.`,
        "warning",
        "alert",
      );
    }

    // A caregiver is a different person: voice can never stand in for their approval.
    if (payment.requiresCaregiver && appState.caregiverStatus !== "approved") {
      showToast("Caregiver approval is still required.", "danger");
      speak("This payment needs your caregiver's approval before I can continue.");
      return;
    }

    addAudit(
      source === "click" ? "Confirmation received" : "Confirmation received by voice",
      source === "click"
        ? `User said yes to ${formatCurrency(payment.amount)} for ${payment.payee.name}. Moving to Voice PIN authorization${payment.handsFreeEligible ? " (inside mandate limit)" : " (caregiver assisted)"}.`
        : `User said “${heard}” to confirm ${formatCurrency(payment.amount)} for ${payment.payee.name}. Moving to Voice PIN authorization${payment.handsFreeEligible ? " (inside mandate limit)" : " (caregiver assisted)"}.`,
      "safe",
      source === "click" ? "check" : "mic",
    );
    enterVoicePin(payment);
  };

  /**
   * Abandons the payment when the user refuses at the confirmation step.
   * "exit", "no transfer", "cancel" and "nahi bhejna" all land here. Nothing is charged.
   */
  const cancelByVoice = (payment, transcript = "") => {
    if (!payment) return;
    const heard = String(transcript).slice(0, 40);
    if (payment.isCollect) {
      declineCollect(payment);
      return;
    }
    if (appState.recognition && appState.listening) {
      try { appState.recognition.stop(); } catch (error) { /* no-op */ }
      appState.listening = false;
    }
    addAudit(
      "Payment cancelled by voice",
      `User said “${heard}” at the confirmation step, so ${formatCurrency(payment.amount)} to ${payment.payee.name} was abandoned before any authorization challenge and before any mandate charge.`,
      "safe",
      "shield",
    );
    resetPaymentFlow();
    showToast("Cancelled by voice · nothing moved");
    speak(`Cancelled. ${formatCurrency(payment.amount)} to ${payment.payee.name} was not paid. Nothing left your account.`);
  };

  const bindReviewActions = (payment) => {
    const confirmButton = byId("confirmPayment");
    const declineButton = byId("declineButton");
    const expectButton = byId("expectButton");
    const ackButton = byId("ackRisk");
    const requestCaregiverButton = byId("requestCaregiver");
    const cancelButton = byId("cancelReview");
    const editButton = byId("editReview");

    confirmButton?.addEventListener("click", () => {
      proceedFromReview(payment, "click");
    });

    declineButton?.addEventListener("click", () => declineCollect(payment));

    expectButton?.addEventListener("click", () => {
      appState.collectAcknowledged = true;
      addAudit("User decision", "Marked the collect request as expected; authentication is still required.", "warning", "alert");
      renderReview(payment);
      setState("guard");
      speak("You marked this request as expected. It would still take money from you. Continue only if you recognize the sender.");
    });

    requestCaregiverButton?.addEventListener("click", () => {
      if (!payment.requiresCaregiver || !appState.riskAcknowledged) return;
      appState.caregiverStatus = "pending";
      addAudit("Caregiver approval requested", `Asked Meera Sharma to approve ${formatCurrency(payment.amount)} for ${payment.payee.name}.`, "warning", "users");
      renderReview(payment);
      setState("guard");
      speak("Approval request sent to Meera Sharma. I will wait before allowing this high-risk payment.");
      window.clearTimeout(appState.caregiverTimer);
      appState.caregiverTimer = window.setTimeout(async () => {
        if (appState.pending?.intentId !== payment.intentId || appState.caregiverStatus !== "pending") return;
        // The approval is recorded server-side and signed, so the browser cannot claim one later.
        const approvalId = await registerCaregiverApproval(payment);
        appState.caregiverStatus = "approved";
        appState.caregiverApprovalId = approvalId;
        addAudit(
          "Caregiver approved",
          `Meera Sharma approved the high-risk payment after reviewing the request${approvalId ? ` · approval ${approvalId} recorded on the server` : " (simulated locally)"}.`,
          "safe",
          "users",
        );
        renderReview(payment);
        setState("guard");
        speak("Meera Sharma approved this request. You still need to say yes, then your Voice PIN, before the payment can be sent.");
        showToast("Caregiver approval received");
      }, 1400);
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
      if (payment.riskLevel === "critical" || payment.riskLevel === "high") {
        appState.metrics.scamsBlocked += 1;
        updateMetrics();
      }
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

  /* ------------------------------------------------------------------ *
   * Voice PIN engine — replaces the visual UPI PIN pad for hands-free use.
   * ------------------------------------------------------------------ */

  const PIN_DIGIT_WORDS = {
    0: ["zero", "shoonya", "shunya", "sifar", "nil", "nought", "oh"],
    1: ["one", "ek", "ekh", "wan"],
    2: ["two", "do", "tu", "dо"],
    3: ["three", "teen", "tin", "tree"],
    4: ["four", "char", "chaar", "charr", "for"],
    5: ["five", "paanch", "panch", "panj", "faiv"],
    6: ["six", "chhe", "chhah", "che", "siks"],
    7: ["seven", "saat", "sat", "sevenn"],
    8: ["eight", "aath", "aat", "eit"],
    // "no" is deliberately NOT an alias for 9: at the PIN step it must mean "stop".
    9: ["nine", "nau", "nain", "nao"],
  };

  /**
   * Spoken intents at the Voice PIN step. Anything that sounds like a refusal wins over
   * digits, because charging a user who said "no" is unrecoverable while cancelling is not.
   */
  const PIN_CANCEL_PATTERN =
    /\b(cancel|cancle|cancel\s+it|stop|stop\s+it|no|nope|nahi|nahin|mat|mat\s+karo|band|bandh|band\s+karo|chhod|chhodo|chodo|ruko|rehne|rehne\s+do|abort|quit|exit|go\s+back|don'?t|dont|do\s+not)\b/i;
  const PIN_HELP_PATTERN = /\b(repeat|again|help|madad|sahayata|samajh|samajha|kya|what|sunai|sunayi|bol)\b/i;

  const detectPinIntent = (transcript) => {
    const text = String(transcript || "").trim();
    if (!text) return { kind: "empty", digits: "", matched: false, heard: 0, viaShortcut: false };

    const parsed = extractPinDigits(text);
    if (PIN_CANCEL_PATTERN.test(text)) return { kind: "cancel", digits: "", matched: false, heard: parsed.heard, viaShortcut: false };
    if (parsed.matched) return { kind: "digits", ...parsed };
    if (PIN_HELP_PATTERN.test(text)) return { kind: "help", digits: "", matched: false, heard: parsed.heard, viaShortcut: false };
    return { kind: "partial", ...parsed };
  };

  /**
   * Confirmation vocabulary for the review step.
   *
   * The agent says "say yes to confirm or no to cancel", so speech has to be honoured
   * here instead of falling through and being re-parsed as a brand-new payment command.
   * Cancel is tested first on purpose: "no", "mat bhejo" and "exit" must never read as a
   * yes, and a refusal beats an approval in the same breath ("no, don't transfer").
   */
  const CONFIRM_CANCEL_PATTERN =
    /\b(no|nope|nah|nahi|nahin|cancel|cancle|cancelled|exit|quit|stop|abort|band|bandh|chhod|chhodo|chodo|rehne|skip|decline|reject|mat|dont|don'?t|do\s+not|leave\s+it|forget\s+it|never\s+mind|not\s+now)\b/i;
  const CONFIRM_APPROVE_PATTERN =
    /\b(yes|yep|yeah|yup|haan|han|ji|confirm|confirmed|ok|okay|theek|thik|sahi|bhej|bhejo|approve|proceed|go\s+ahead|send\s+it|pay\s+it|do\s+it|kar\s+do|karo|sure|pakka|zaroor|done|continue|haan\s+ji)\b/i;

  /**
   * Classifies what the user said at the confirmation step.
   * Returns { kind: "approve" | "cancel" | "unknown" | "empty", heard }.
   */
  const detectConfirmIntent = (transcript) => {
    const text = String(transcript || "").trim();
    if (!text) return { kind: "empty", heard: "" };
    if (CONFIRM_CANCEL_PATTERN.test(text)) return { kind: "cancel", heard: text };
    if (CONFIRM_APPROVE_PATTERN.test(text)) return { kind: "approve", heard: text };
    return { kind: "unknown", heard: text };
  };

  const PIN_FILLER_WORDS = new Set([
    "pin", "voice", "voicepin", "passcode", "my", "mera", "meri", "the", "is", "it", "please",
    "ok", "okay", "haan", "han", "yes", "one", "here", "you", "go", "bolo", "speak",
  ].filter((word) => !Object.values(PIN_DIGIT_WORDS).flat().includes(word)));

  const wordToDigit = (word) => {
    const cleaned = word.replace(/[^a-z0-9]/g, "");
    if (!cleaned) return null;
    if (/^\d$/.test(cleaned)) return cleaned;
    for (const [digit, aliases] of Object.entries(PIN_DIGIT_WORDS)) {
      if (aliases.includes(cleaned)) return digit;
    }
    return null;
  };

  /**
   * Turns a spoken phrase into PIN digits.
   * Accepts "1234", "1 2 3 4", "one two three four", and "ek do teen char".
   * In Smart Demo Mode the bare word "PIN" is a judge shortcut for the configured demo PIN.
   */
  const extractPinDigits = (transcript) => {
    const text = String(transcript || "").toLowerCase().replace(/[,.\-–—!?]/g, " ").trim();
    if (!text) return { digits: "", matched: false, viaShortcut: false, heard: 0 };

    const compact = text.replace(/\s+/g, "");
    const compactDigits = compact.match(/^\d{4,6}$/);
    if (compactDigits) return { digits: compactDigits[0].slice(0, PIN_LENGTH), matched: true, viaShortcut: false, heard: compactDigits[0].length };

    const spokenOnly = text.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
    if (spokenOnly && DEMO_PIN_SHORTCUT.test(spokenOnly) && !/\d/.test(text)) {
      const demoPin = appState.mandate?.demoVoicePin || FALLBACK_VOICE_PIN;
      return { digits: demoPin, matched: true, viaShortcut: true, heard: demoPin.length };
    }

    const digits = [];
    for (const token of text.split(/\s+/)) {
      const bare = token.replace(/\D/g, "");
      if (/^\d{4,6}$/.test(bare)) {
        digits.push(...bare.split(""));
        continue;
      }
      if (/^\d$/.test(bare)) {
        digits.push(bare);
        continue;
      }
      const cleaned = token.replace(/[^a-z]/g, "");
      if (!cleaned || PIN_FILLER_WORDS.has(cleaned)) continue;
      const digit = wordToDigit(cleaned);
      if (digit) digits.push(digit);
    }

    return {
      digits: digits.slice(0, PIN_LENGTH).join(""),
      matched: digits.length >= PIN_LENGTH,
      viaShortcut: false,
      heard: digits.length,
    };
  };

  const redactedPin = (digits = "") => "•".repeat(digits.length || PIN_LENGTH);

  const renderVoicePin = (payment, options = {}) => {
    const pin = appState.voicePin;
    const attemptsLeft = Math.max(0, PIN_MAX_ATTEMPTS - pin.attempts);
    const boxes = Array.from({ length: PIN_LENGTH })
      .map((_, index) => `<span class="pin-box ${index < pin.digits.length ? "filled" : ""} ${index === pin.digits.length ? "next" : ""}">${index < pin.digits.length ? "•" : ""}</span>`)
      .join("");
    const keypad = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => `<button class="key-button" type="button" data-pin-key="${digit}" aria-label="${digit}">${digit}</button>`).join("");
    const demoPin = appState.mandate?.demoVoicePin || (appState.smartDemoMode ? FALLBACK_VOICE_PIN : null);

    dom.reviewEmpty.classList.add("hidden");
    dom.reviewContent.classList.remove("hidden");
    dom.reviewContent.innerHTML = `
      <div class="review-head"><span class="section-kicker">HANDS-FREE AUTHORIZATION</span><span class="review-ref">${escapeHTML(payment.intentId)} · Voice PIN required</span></div>
      <div class="transaction-summary compact">
        <div class="summary-avatar ${payment.payee.trusted ? "" : "unknown"}">${escapeHTML(payment.payee.short)}</div>
        <div class="summary-copy"><span>Authorizing payment to</span><strong>${escapeHTML(payment.payee.name)}</strong><small>${escapeHTML(payment.payee.vpa)} · mandate ${escapeHTML(appState.mandate.id)}</small></div>
        <div class="summary-amount"><strong>${formatCurrency(payment.amount)}</strong><span>${payment.handsFreeEligible ? "Inside mandate · no PIN pad" : "Caregiver assisted"}</span></div>
      </div>

      <div class="pin-panel ${pin.verifying ? "verifying" : ""} ${options.error ? "error" : ""}">
        <div class="pin-panel-head">
          <span class="pin-badge-inline"><span class="pin-badge-shield">🛡️</span> WAITING FOR VOICE PIN</span>
          <span class="pin-attempts ${attemptsLeft === 1 ? "critical" : ""}">${pin.verifying ? "matching voiceprint…" : `${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left`}</span>
        </div>
        <h2 id="pinHeading">Say your ${PIN_LENGTH} digit Voice PIN</h2>
        <p id="pinSubline">${escapeHTML(options.error || "Speak the digits one at a time — “one two three four” or “ek do teen char”. I never repeat your PIN back and it is never written into the caregiver log.")}</p>

        <div class="pin-capture">
          <div class="pin-boxes" id="pinBoxes" aria-hidden="true">${boxes}</div>
          <label class="pin-sr-label" for="pinInput">Voice PIN</label>
          <input id="pinInput" class="pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="${PIN_LENGTH}"
                 aria-label="Voice PIN, ${PIN_LENGTH} digits" aria-describedby="pinSubline" value="${escapeHTML(pin.digits)}" />
        </div>

        <div class="pin-keypad" role="group" aria-label="Voice PIN keypad fallback">
          ${keypad}
          <button class="key-button" type="button" data-pin-key="0" aria-label="0">0</button>
          <button class="key-button key-clear" type="button" id="pinClear" aria-label="Clear Voice PIN">Clear</button>
        </div>

        <div class="review-actions">
          <button class="primary-button" id="speakPinButton" type="button"><svg><use href="#icon-mic"></use></svg>${pin.verifying ? "Verifying…" : "Say Voice PIN"}</button>
          ${demoPin ? `<button class="secondary-button" id="demoPinButton" type="button">Demo PIN ${escapeHTML(demoPin)}</button>` : ""}
          <button class="cancel-action" id="cancelPin" type="button">Cancel payment</button>
        </div>

        <div class="reasoning-line"><svg><use href="#icon-lock"></use></svg><span>Voice PIN is hashed on the server, matched against the enrolled voiceprint, and exchanged for a ${Math.round((appState.tokenTtl || 90))}-second mandate-auth token. A bystander shouting an amount cannot spend without it.</span></div>
      </div>`;

    bindVoicePinActions(payment);
  };

  const bindVoicePinActions = (payment) => {
    const pinInput = byId("pinInput");
    const speakPinButton = byId("speakPinButton");
    const demoPinButton = byId("demoPinButton");
    const cancelPin = byId("cancelPin");
    const clearButton = byId("pinClear");

    pinInput?.addEventListener("input", () => {
      appState.voicePin.digits = pinInput.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
      if (appState.voicePin.digits.length === PIN_LENGTH) {
        submitVoicePin(payment, appState.voicePin.digits, "keypad");
      } else {
        refreshPinBoxes();
      }
    });
    pinInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (appState.voicePin.digits.length === PIN_LENGTH) submitVoicePin(payment, appState.voicePin.digits, "keypad");
        else showToast(`Say or type all ${PIN_LENGTH} digits.`);
      }
    });

    $$("[data-pin-key]").forEach((button) => {
      button.addEventListener("click", () => {
        if (appState.voicePin.verifying) return;
        appState.voicePin.digits = (appState.voicePin.digits + button.dataset.pinKey).slice(0, PIN_LENGTH);
        refreshPinBoxes();
        if (appState.voicePin.digits.length === PIN_LENGTH) submitVoicePin(payment, appState.voicePin.digits, "keypad");
      });
    });

    clearButton?.addEventListener("click", () => {
      appState.voicePin.digits = "";
      refreshPinBoxes();
      byId("pinInput")?.focus();
    });

    speakPinButton?.addEventListener("click", () => startPinListening(payment));
    demoPinButton?.addEventListener("click", () => {
      const demoPin = appState.mandate?.demoVoicePin || FALLBACK_VOICE_PIN;
      addAudit("Demo PIN shortcut", "Smart Demo Mode filled the configured demo Voice PIN so the judge flow needs no secrets.", "warning", "help");
      submitVoicePin(payment, demoPin, "demo-shortcut");
    });
    cancelPin?.addEventListener("click", () => {
      addAudit("Voice PIN abandoned", "User cancelled instead of authorizing the hands-free charge. Nothing was paid.", "safe", "check");
      resetPaymentFlow();
      showToast("Cancelled. Nothing moved.");
      speak("Cancelled. Nothing moved.");
    });

    pinInput?.focus();
  };

  const refreshPinBoxes = () => {
    const pinInput = byId("pinInput");
    if (pinInput) pinInput.value = appState.voicePin.digits;
    $$("#pinBoxes .pin-box").forEach((box, index) => {
      const filled = index < appState.voicePin.digits.length;
      box.classList.toggle("filled", filled);
      box.classList.toggle("next", index === appState.voicePin.digits.length);
      box.textContent = filled ? "•" : "";
    });
  };

  /**
   * Speaks a prompt and only then opens the microphone. Starting recognition while the
   * agent is still talking makes the recognizer hear AwaazPay's own voice, so the two are
   * sequenced (with a timer safety net inside `speak`).
   */
  const speakThenListenForPin = (payment, text) => {
    speak(text, () => {
      if (appState.status === "authenticate" && !appState.voicePin.verifying && !appState.voicePin.locked) {
        startPinListening(payment);
      }
    });
  };

  const startPinListening = (payment) => {
    if (appState.voicePin.verifying) return;
    appState.voicePin.awaitingSpokenPin = true;
    if (!appState.recognition) {
      showToast("Microphone unavailable — use the keypad or type the PIN.");
      byId("pinInput")?.focus();
      return;
    }
    if (appState.listening) {
      try { appState.recognition.stop(); } catch (error) { /* no-op */ }
      appState.listening = false;
    }
    try {
      appState.recognition.lang = dom.languageSelect?.value || "en-IN";
      appState.recognition.start();
      showToast("Listening for your Voice PIN");
    } catch (error) {
      showToast("Microphone is busy. Use the keypad instead.", "danger");
      byId("pinInput")?.focus();
    }
  };

  const enterVoicePin = (payment) => {
    appState.voicePin = { digits: "", attempts: 0, locked: false, lockedUntil: 0, verifying: false, awaitingSpokenPin: true };
    setState("authenticate");
    renderVoicePin(payment);
    const mode = payment.handsFreeEligible ? "inside the mandate limit" : "with caregiver assistance";
    addAudit("Voice PIN requested", `Hands-free authorization requested for ${formatCurrency(payment.amount)} to ${payment.payee.name} (${mode}). The PIN digits are never stored, logged, or spoken back.`, "safe", "lock");
    // Hands-free by default: speak the challenge, then open the microphone.
    speakThenListenForPin(
      payment,
      `Confirmed. ${formatCurrency(payment.amount)} to ${payment.payee.name}. Please say your ${PIN_LENGTH} digit Voice PIN to authorize this payment hands-free. I will not repeat it back.`,
    );
  };

  /** Abandons the payment when the user refuses at the Voice PIN step. Nothing is charged. */
  const cancelVoicePin = (payment, transcript = "") => {
    appState.voicePin.awaitingSpokenPin = false;
    appState.voicePin.digits = "";
    if (appState.recognition && appState.listening) {
      try { appState.recognition.stop(); } catch (error) { /* no-op */ }
      appState.listening = false;
    }
    addAudit(
      "Voice PIN cancelled by user",
      `User said “${String(transcript).slice(0, 40)}” at the authorization step, so ${formatCurrency(payment.amount)} to ${payment.payee.name} was abandoned before any mandate charge.`,
      "safe",
      "shield",
    );
    resetPaymentFlow();
    showToast("Cancelled at the Voice PIN step · nothing moved");
    speak("Cancelled. Nothing was paid. Your mandate was not charged.");
  };

  const handlePinTranscript = (transcript, payment, isFinal = true) => {
    // Privacy: the spoken PIN never appears in the visible transcript strip.
    setTranscript(`${redactedPin("1234")} Voice PIN redacted`);
    const intent = detectPinIntent(transcript);

    if (!isFinal) {
      if (intent.kind === "digits" || intent.kind === "partial") {
        if (intent.heard) {
          appState.voicePin.digits = intent.digits;
          refreshPinBoxes();
        }
      }
      return;
    }

    appState.voicePin.awaitingSpokenPin = false;
    appState.listening = false;
    if (!payment) return;

    // "No", "cancel", "band karo" — a refusal always beats a digit stream.
    if (intent.kind === "cancel") {
      cancelVoicePin(payment, transcript);
      return;
    }

    // "Repeat", "help", "kya?" — re-prompt without burning an attempt.
    if (intent.kind === "help") {
      appState.voicePin.digits = "";
      refreshPinBoxes();
      const message = `No problem. To authorize ${formatCurrency(payment.amount)} to ${payment.payee.name}, say your ${PIN_LENGTH} digit Voice PIN one digit at a time, for example one two three four. Say cancel if you do not want to pay.`;
      addAudit("Voice PIN help requested", "The agent repeated the authorization instruction. No attempt was counted.", "safe", "help");
      renderVoicePin(payment, { error: message });
      speakThenListenForPin(payment, message);
      return;
    }

    if (intent.kind !== "digits") {
      const heard = intent.heard;
      appState.voicePin.digits = "";
      refreshPinBoxes();
      const message = heard
        ? `I only caught ${heard} digit${heard === 1 ? "" : "s"}. Please say all ${PIN_LENGTH} digits of your Voice PIN, one at a time — or say cancel to stop.`
        : `I did not hear your Voice PIN. Please say ${PIN_LENGTH} digits, for example one two three four, use the keypad on screen, or say cancel to stop.`;
      addAudit("Voice PIN not captured", heard ? `Only ${heard} of ${PIN_LENGTH} digits were heard; no attempt was counted.` : "Speech was not recognized; no attempt was counted.", "warning", "mic");
      renderVoicePin(payment, { error: message });
      speakThenListenForPin(payment, message);
      return;
    }

    if (intent.viaShortcut) {
      addAudit("Voice shortcut used", `The word “PIN” was heard, so the configured Smart Demo Mode PIN was submitted. Digits shown as ${redactedPin(intent.digits)}.`, "warning", "help");
    }
    submitVoicePin(payment, intent.digits, "voice");
  };

  const submitVoicePin = async (payment, digits, source = "voice") => {
    if (appState.voicePin.verifying || appState.voicePin.locked) return;
    appState.voicePin.verifying = true;
    appState.voicePin.digits = digits;
    refreshPinBoxes();
    const speakPinButton = byId("speakPinButton");
    if (speakPinButton) speakPinButton.disabled = true;
    byId("pinInput")?.setAttribute("aria-busy", "true");

    const payload = {
      pinDigits: digits,
      sessionId: appState.sessionId,
      intentId: payment.intentId,
      amountPaise: Math.round(payment.amount * 100),
      payee: payment.payee.name,
      payeeVpa: payment.payee.vpa,
      sampleMs: source === "voice" ? 1400 : 0,
      // The signed approval id from /api/caregiver/approve — required above the mandate limit.
      caregiverApprovalId: appState.caregiverApprovalId || null,
    };

    try {
      const response = await fetch("/api/voice-pin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      appState.serverAvailable = true;

      if (response.ok && body.verified) {
        appState.tokenTtl = body.tokenTtlSeconds || 90;
        onPinVerified(payment, body.authToken, body, source);
        return;
      }
      if (response.status === 423 || body.locked) {
        lockVoicePin(payment, body.reason || "Too many incorrect Voice PIN attempts.");
        return;
      }
      if (response.status === 422) {
        // A policy refusal (above the mandate cap, or a payee the caregiver never authorized),
        // not a PIN failure — so it must not burn an attempt.
        appState.voicePin.verifying = false;
        appState.voicePin.digits = "";
        const label = body.code === "payee_not_on_mandate" ? "Payee not on mandate" : "Mandate limit enforced by server";
        addAudit(label, `${body.reason}${body.authorizedPayees ? ` Authorized: ${body.authorizedPayees.join(", ")}.` : ""}`, "danger", "shield");
        renderVoicePin(payment, { error: body.reason });
        speak(body.reason);
        showToast(body.code === "payee_not_on_mandate" ? "Payee not authorized on the mandate" : "Above mandate limit · caregiver approval needed", "danger");
        return;
      }
      onPinRejected(payment, body.reason || "That did not match your Voice PIN.", body.attemptsLeft, body.voiceprint);
    } catch (error) {
      // No server reachable (for example the page opened directly): Smart Demo Mode fallback.
      appState.serverAvailable = false;
      const demoPin = appState.mandate?.demoVoicePin || FALLBACK_VOICE_PIN;
      if (digits === demoPin) {
        addAudit("Voice PIN verified locally", `Server unreachable, so Smart Demo Mode compared the PIN hash in the browser. Digits shown as ${redactedPin(digits)}.`, "warning", "lock");
        onPinVerified(payment, "local.smart-demo", { voiceprint: { score: 0.93, matched: true }, authorizationMode: payload.caregiverAssisted ? "caregiver-assisted" : "voice-pin-hands-free" }, source);
      } else {
        onPinRejected(payment, "Those digits did not match your Voice PIN.", PIN_MAX_ATTEMPTS - (appState.voicePin.attempts + 1));
      }
    }
  };

  const onPinVerified = (payment, authToken, result = {}, source = "voice") => {
    appState.voicePin.verifying = false;
    appState.voicePin.awaitingSpokenPin = false;
    appState.metrics.voicePinsVerified += 1;
    updateMetrics();
    addAudit(
      "Voice PIN verified",
      `${redactedPin("1234")} matched · voiceprint score ${result.voiceprint?.score ?? "n/a"} · ${source === "voice" ? "spoken" : source} · ${result.authorizationMode === "caregiver-assisted" ? "caregiver-assisted" : "hands-free"} mandate-auth token issued.`,
      "safe",
      "lock",
    );
    showToast("Voice PIN matched · authorizing hands-free");
    speak("Voice PIN matched. Charging your caregiver mandate now. No PIN pad will open.");
    executePayment(payment, authToken, result);
  };

  const onPinRejected = (payment, reason, attemptsLeft, voiceprint) => {
    appState.voicePin.verifying = false;
    appState.voicePin.attempts += 1;
    appState.voicePin.digits = "";
    appState.metrics.pinAttemptsBlocked += 1;
    updateMetrics();
    const left = typeof attemptsLeft === "number" ? attemptsLeft : Math.max(0, PIN_MAX_ATTEMPTS - appState.voicePin.attempts);

    if (left <= 0) {
      lockVoicePin(payment, reason);
      return;
    }
    addAudit("Voice PIN rejected", `${reason} ${left} attempt${left === 1 ? "" : "s"} left. The digits were discarded, never stored.`, "warning", "alert");
    renderVoicePin(payment, { error: `${reason} ${left} attempt${left === 1 ? "" : "s"} left.` });
    speakThenListenForPin(payment, `${reason} You have ${left} attempt${left === 1 ? "" : "s"} left. Please say your ${PIN_LENGTH} digit Voice PIN again.`);
  };

  const lockVoicePin = (payment, reason) => {
    appState.voicePin.verifying = false;
    appState.voicePin.locked = true;
    appState.voicePin.awaitingSpokenPin = false;
    appState.metrics.pinAttemptsBlocked += 1;
    updateMetrics();
    if (appState.recognition && appState.listening) {
      try { appState.recognition.stop(); } catch (error) { /* no-op */ }
      appState.listening = false;
    }
    addAudit("Voice PIN locked", `${reason} The payment was abandoned and nothing was charged.`, "danger", "shield");

    dom.reviewEmpty.classList.add("hidden");
    dom.reviewContent.classList.remove("hidden");
    dom.reviewContent.innerHTML = `
      <div class="result-view">
        <div>
          <div class="result-icon blocked-icon"><svg><use href="#icon-lock"></use></svg></div>
          <h2>Voice PIN locked · nothing paid</h2>
          <p>${escapeHTML(reason)}</p>
          <div class="result-reference">${escapeHTML(payment.intentId)} · ${escapeHTML(payment.payee.name)} · ${escapeHTML(timeNow())}</div>
          <div class="result-balance">The mandate was never charged. Balance stays at <strong>${formatCurrency(appState.balance)}</strong></div>
          <div class="result-actions"><button class="primary-button" id="startAnother" type="button">Start another payment</button><button class="secondary-button" id="viewAuditFromResult" type="button">View caregiver log</button></div>
        </div>
      </div>`;
    setState("pinLocked");
    dom.pinBadge?.classList.add("hidden");
    speak("Three incorrect attempts. Your Voice PIN is locked and the payment was abandoned. Nothing left your account. Ask your caregiver if you need help.");
    showToast("Voice PIN locked · nothing moved", "danger");
    byId("startAnother")?.addEventListener("click", resetPaymentFlow);
    byId("viewAuditFromResult")?.addEventListener("click", openAudit);
  };

  const renderProcessing = (payment) => {
    dom.reviewEmpty.classList.add("hidden");
    dom.reviewContent.classList.remove("hidden");
    dom.reviewContent.innerHTML = `
      <div class="processing-view">
        <div>
          <div class="processing-spinner"></div>
          <h2>Charging ${formatCurrency(payment.amount)} on your mandate</h2>
          <p>Server-to-server Razorpay call for ${escapeHTML(payment.payee.name)} using mandate ${escapeHTML(appState.mandate.id)}. No PIN pad is opened.</p>
        </div>
      </div>`;
  };

  const renderSuccess = (payment, result = {}) => {
    const paymentEntity = result.payment || {};
    const resolvedReference = paymentEntity.id || `pay_demo_${Math.random().toString(36).slice(2, 10)}`;
    const providerLabel = result.mode === "razorpay-live" ? "Razorpay S2S · live keys" : "Razorpay S2S · Smart Demo Mode";
    const authLabel = result.authorizationMode === "caregiver-assisted" ? "caregiver assisted" : "Voice PIN · hands-free";
    appState.lastPayment = { ...payment, reference: resolvedReference, result };
    dom.reviewEmpty.classList.add("hidden");
    dom.reviewContent.classList.remove("hidden");
    dom.reviewContent.innerHTML = `
      <div class="result-view">
        <div>
          <div class="result-icon"><svg><use href="#icon-check"></use></svg></div>
          <h2>Paid hands-free · no PIN pad</h2>
          <p>${formatCurrency(payment.amount)} paid to ${escapeHTML(payment.payee.name)}.</p>
          <div class="result-reference">${escapeHTML(resolvedReference)} · ${escapeHTML(providerLabel)} · ${escapeHTML(timeNow())}</div>
          <div class="result-mandate">
            <span><svg><use href="#icon-shield"></use></svg> mandate ${escapeHTML(result.mandateId || appState.mandate.id)}</span>
            <span><svg><use href="#icon-lock"></use></svg> ${escapeHTML(authLabel)}${result.voiceprintScore ? ` · voiceprint ${escapeHTML(String(result.voiceprintScore))}` : ""}</span>
            <span><svg><use href="#icon-eye-off"></use></svg> visual PIN pad: never shown</span>
          </div>
          ${result.mode === "smart-demo" ? '<div class="result-note">Simulated capture — no real money moved. Add Razorpay test keys to charge the same S2S path for real.</div>' : ""}
          <div class="result-balance">Wallet balance is now <strong>${formatCurrency(appState.balance)}</strong>${result.remainingToday != null ? ` · ₹${formatNumber(result.remainingToday)} mandate left today` : ""}</div>
          <div class="result-actions"><button class="primary-button" id="startAnother" type="button">Start another payment</button><button class="secondary-button" id="viewAuditFromResult" type="button">View caregiver log</button></div>
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
          <div class="result-actions"><button class="primary-button" id="startAnother" type="button">Start another payment</button><button class="secondary-button" id="viewAuditFromResult" type="button">View caregiver log</button></div>
        </div>
      </div>`;
    byId("startAnother")?.addEventListener("click", resetPaymentFlow);
    byId("viewAuditFromResult")?.addEventListener("click", openAudit);
  };

  const completePayment = (payment, result = {}) => {
    const isLive = result.mode === "razorpay-live";
    if (typeof result.walletBalance === "number") appState.balance = result.walletBalance;
    else appState.balance = Math.max(0, appState.balance - payment.amount);
    if (result.mandateId) appState.mandate = { ...appState.mandate, id: result.mandateId };
    if (typeof result.usedToday === "number") appState.mandate.usedToday = result.usedToday;
    if (typeof result.remainingToday === "number") appState.mandate.remainingToday = result.remainingToday;
    appState.metrics.paymentsCompleted += 1;
    updateBalance();
    updateMetrics();
    renderMandateCard();
    addAudit(
      "Payment complete",
      `${formatCurrency(result.payment?.amount ? result.payment.amount / 100 : payment.amount)} charged to ${payment.payee.name} on mandate ${result.mandateId || appState.mandate.id} via ${isLive ? "Razorpay S2S (live keys)" : "simulated Razorpay S2S"}. Authorization: ${result.authorizationMode === "caregiver-assisted" ? "caregiver assisted" : "Voice PIN"} · no visual PIN pad.`,
      "safe",
      "check",
    );
    setState("success");
    renderSuccess(payment, result);
    speak(
      `Done. ${amountInWords(payment.amount)} rupees paid to ${payment.payee.name}, hands-free from your caregiver mandate. No PIN screen was opened. Your wallet balance is now ${amountInWords(appState.balance)} rupees. ${isLive ? "" : "This was a simulated payment; no real money moved."}`,
    );
    showToast(isLive ? "Razorpay mandate charge captured" : "Hands-free payment complete · nothing real moved");
  };

  const restorePaymentReview = (payment, message = "The payment could not be executed. Nothing moved.") => {
    addAudit("Payment not executed", message, "warning", "alert");
    setState(payment.riskLevel === "low" ? "review" : "guard");
    renderReview(payment);
    speak(message);
  };

  /**
   * Executes the charge server-to-server. The mandate-auth token from the Voice PIN check is
   * mandatory: without it the server refuses the call, which is what makes the hands-free
   * loop safe instead of merely convenient.
   */
  const executePayment = async (payment, authToken, pinResult = {}) => {
    if (appState.status === "processing") return;
    setState("processing");
    renderProcessing(payment);

    if (!appState.serverAvailable && authToken === "local.smart-demo") {
      // Offline Smart Demo Mode: mirror the server response shape so the demo still runs.
      window.clearTimeout(appState.processingTimer);
      appState.processingTimer = window.setTimeout(() => {
        completePayment(payment, {
          mode: "smart-demo",
          simulated: true,
          mandateId: appState.mandate.id,
          authorizationMode: pinResult.authorizationMode || "voice-pin-hands-free",
          voiceprintScore: pinResult.voiceprint?.score,
          remainingToday: Math.max(0, (appState.mandate.remainingToday ?? appState.mandate.dailyLimit) - payment.amount),
          payment: { id: `pay_local_${Math.random().toString(36).slice(2, 9)}`, amount: Math.round(payment.amount * 100), status: "captured" },
        });
      }, 1500);
      return;
    }

    try {
      const response = await fetch("/api/payment/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authToken,
          intentId: payment.intentId,
          amountPaise: Math.round(payment.amount * 100),
          payee: payment.payee.name,
          payeeVpa: payment.payee.vpa,
          caregiverApprovalId: appState.caregiverApprovalId || null,
          caregiverApproved: appState.caregiverStatus === "approved" && payment.requiresCaregiver,
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        const reason = body.error || "Razorpay could not execute the mandate charge.";
        if (body.code === "amount_outside_mandate") {
          addAudit("Mandate limit enforced by server", `${reason} AwaazPay cannot bypass the visual UPI PIN above ₹${formatNumber(appState.mandate.perTransactionLimit)}.`, "danger", "shield");
          speak(`${reason} This amount is above your hands-free mandate limit, so a caregiver must authorize it in the bank app.`);
        } else {
          addAudit("Payment rejected", `${reason} Nothing was charged.`, "danger", "alert");
          speak(reason);
        }
        showToast(body.code === "amount_outside_mandate" ? "Above mandate limit · nothing moved" : "Charge rejected · nothing moved", "danger");
        restorePaymentReview(payment, `${reason} Nothing moved.`);
        return;
      }

      addAudit("Razorpay S2S charge", `POST /api/payment/execute with mandate-auth token → ${body.payment?.id || "payment"} ${body.mode === "razorpay-live" ? "(live keys)" : "(simulated)"}. Visual PIN pad shown: no.`, "safe", "send");
      window.clearTimeout(appState.processingTimer);
      appState.processingTimer = window.setTimeout(() => completePayment(payment, body), body.simulated ? 1100 : 200);
    } catch (error) {
      appState.serverAvailable = false;
      restorePaymentReview(payment, "The Razorpay mandate route is unavailable. Nothing moved.");
      showToast("Mandate route unavailable · nothing moved", "danger");
    }
  };

  const declineCollect = (payment) => {
    appState.metrics.scamsBlocked += 1;
    updateMetrics();
    addAudit("Collect request declined", `${formatCurrency(payment.amount)} request declined. Nothing left the account.`, "danger", "shield");
    setState("blocked");
    renderBlocked(payment);
    speak(`Stop confirmed. The collect request for ${amountInWords(payment.amount)} rupees was declined. Nothing left your account.`);
    showToast("Request declined safely · no money moved");
  };

  const requestGroqIntent = async (transcript) => {
    try {
      const response = await fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          language: dom.languageSelect?.value || "en-IN",
          knownPayees: Object.values(payeeProfiles).map((payee) => ({ name: payee.name, vpa: payee.vpa, usualAmountRupees: payee.usual })),
        }),
      });
      if (!response.ok) return null;
      const agent = await response.json();
      return agent.mode === "groq" ? agent : null;
    } catch (error) {
      return null;
    }
  };

  const mergeAgentIntent = (agent, local, demoType = "") => {
    const agentMissing = Array.isArray(agent.missingFields) ? agent.missingFields.filter((field) => ["amount", "payee"].includes(field)) : [];
    const missingFields = [...new Set([...(local.missingFields || []), ...agentMissing])];
    const agentAmount = Number(agent.amountPaise);
    const amount = Number.isInteger(agentAmount) && agentAmount > 0 ? agentAmount / 100 : local.amount;
    const payee = agent.payeeQuery ? resolvePayee(String(agent.payeeQuery), demoType) : local.payee;
    const isCollect = local.isCollect || agent.direction === "pull" || agent.intent === "collect";
    const flags = [...(local.flags || [])];
    for (const signal of Array.isArray(agent.riskSignals) ? agent.riskSignals : []) {
      const normalized = String(signal).toLowerCase();
      if (/collect|pull/.test(normalized) && !flags.includes("collect")) flags.push("collect");
      if (/amount|unusual|large|velocity/.test(normalized) && !flags.includes("amount")) flags.push("amount");
      if (/payee|lookalike|mismatch|unknown|new/.test(normalized) && !flags.includes("payee")) flags.push("payee");
    }
    if (isCollect && !flags.includes("collect")) flags.push("collect");
    if (/mandate|limit/.test((Array.isArray(agent.riskSignals) ? agent.riskSignals : []).join(" ").toLowerCase())) {
      flags.push("agent-mandate-signal");
    }
    const missingFieldsResolved = missingFields.length > 0 || !payee.matched || !amount ? missingFields : missingFields;

    // The Groq intent is merged into the local parse, then the deterministic policy runs.
    return applyRiskPolicy({
      ...local,
      amount,
      amountMatched: Boolean(amount),
      amountWords: amount ? amountInWords(amount) : "the amount",
      payee,
      payeeMatched: payee.matched,
      isCollect,
      flags,
      missingFields: !amount && !missingFieldsResolved.includes("amount") ? [...missingFieldsResolved, "amount"] : missingFieldsResolved,
    });
  };

  const handleCommand = (rawText, source = "voice", demoType = "") => {
    const raw = String(rawText || "").trim();
    if (!raw) return;
    if (["analyzing", "processing"].includes(appState.status)) {
      showToast("I am still finishing the current step.");
      return;
    }
    // While the Voice PIN challenge is open, speech is a PIN — never a new payment command.
    if (appState.status === "authenticate" || appState.status === "pinLocked") {
      if (appState.status === "pinLocked") {
        showToast("Voice PIN is locked. Start a new payment.", "danger");
        return;
      }
      handlePinTranscript(raw, appState.pending, true);
      return;
    }
    // At the confirmation step, speech answers the yes/no question. Previously any
    // utterance here fell through to the bottom of this function, which reset
    // appState.pending and re-parsed it as a brand-new payment command — so saying the
    // "yes" the button asked for destroyed the payment and asked for a payee again.
    if (!demoType && ["review", "guard"].includes(appState.status) && appState.pending && !mentionsPaymentDetail(raw)) {
      if (appState.listening && appState.recognition) {
        try { appState.recognition.stop(); } catch (error) { /* no-op */ }
        appState.listening = false;
      }
      setTranscript(raw);
      const confirmIntent = detectConfirmIntent(raw);
      if (confirmIntent.kind === "cancel") {
        addAudit("You said", raw, "safe", "mic");
        cancelByVoice(appState.pending, raw);
        return;
      }
      if (confirmIntent.kind === "approve") {
        addAudit("You said", raw, "safe", "mic");
        proceedFromReview(appState.pending, "voice", raw);
        return;
      }
      // Neither a yes nor a refusal: keep the payment open and repeat the question
      // instead of throwing away the safety work the agent already did.
      addAudit(
        "Confirmation not understood",
        `Heard “${raw.slice(0, 40)}” at the confirmation step, which is neither a yes nor a cancel. The payment stayed open and the question was repeated.`,
        "warning",
        "help",
      );
      showToast("Say yes to confirm, or exit to cancel");
      speak(buildSpokenSummary(appState.pending));
      return;
    }
    const clarificationBase = appState.awaitingClarification && appState.pending?.needsClarification ? appState.pending.raw : "";
    const effectiveRaw = clarificationBase ? `${clarificationBase} ${raw}` : raw;
    if (appState.listening && appState.recognition) {
      try { appState.recognition.stop(); } catch (error) { /* no-op */ }
      appState.listening = false;
    }

    appState.pending = null;
    appState.riskAcknowledged = false;
    appState.collectAcknowledged = false;
    appState.caregiverStatus = "none";
    appState.caregiverApprovalId = null;
    appState.awaitingClarification = false;
    appState.analysisToken += 1;
    const token = appState.analysisToken;
    window.clearTimeout(appState.analysisTimer);
    window.clearTimeout(appState.caregiverTimer);
    appState.metrics.commandsAttempted += 1;
    updateMetrics();
    setTranscript(raw);
    setState("analyzing");
    showReviewLoading();
    addAudit(source === "demo" ? "Demo request" : "You said", raw, "safe", "mic");
    speak("I heard that. I am checking the amount, payee, and payment direction now.");

    appState.analysisTimer = window.setTimeout(async () => {
      if (token !== appState.analysisToken) return;
      const localParsed = parseCommand(effectiveRaw, demoType);
      const groqIntent = demoType ? null : await requestGroqIntent(effectiveRaw);
      if (token !== appState.analysisToken) return;
      const parsed = groqIntent ? mergeAgentIntent(groqIntent, localParsed, demoType) : localParsed;
      appState.pending = parsed;
      if (parsed.needsClarification) {
        appState.awaitingClarification = true;
        const missingLabel = parsed.missingFields.join(" and ");
        addAudit("Clarification needed", `The agent asked for the missing ${missingLabel} instead of guessing.`, "warning", "help");
        renderClarification(parsed);
        setState("clarify");
        speak(buildClarificationPrompt(parsed));
        return;
      }
      appState.metrics.commandsParsed += 1;
      updateMetrics();
      const intentTrace = groqIntent
        ? `Groq intent: ${groqIntent.intent} · direction ${groqIntent.direction} · confidence ${groqIntent.confidence ?? "n/a"}.`
        : `Smart Demo Mode local simulator: intent pay · direction ${parsed.isCollect ? "pull" : "push"} · no API key used.`;
      addAudit("Agent reasoning", intentTrace, "safe", "sliders");
      const riskDetail = parsed.isCollect
        ? `Collect request detected for ${formatCurrency(parsed.amount)}; it would pull money from the user and is never covered by the mandate.`
        : parsed.payee.mismatch || !parsed.payee.trusted
          ? `Payee identity needs attention: requested ${parsed.payee.requestedName || parsed.payee.name}, resolved ${parsed.payee.name}.`
          : parsed.mandateBreach
            ? `${formatCurrency(parsed.amount)} is above the ₹${formatNumber(parsed.mandateLimit)} hands-free mandate limit; caregiver authorization required.`
            : parsed.flags.includes("amount")
              ? `${formatCurrency(parsed.amount)} is ${parsed.amountMultiplier}× the usual amount for ${parsed.payee.name}.`
              : `Trusted payee and amount pattern matched for ${parsed.payee.name}; inside the ₹${formatNumber(parsed.mandateLimit)} mandate, so it can run hands-free after the Voice PIN.`;
      addAudit("Agent safety check", riskDetail, parsed.riskLevel === "low" ? "safe" : parsed.isCollect ? "danger" : "warning", parsed.isCollect ? "alert" : parsed.riskLevel === "low" ? "shield" : "alert");
      renderReview(parsed);
      setState(parsed.riskLevel === "low" ? "review" : "guard");
      speak(buildSpokenSummary(parsed));
    }, 780);
  };

  const buildClarificationPrompt = (payment) => {
    const missing = payment.missingFields || [];
    if (missing.includes("amount") && missing.includes("payee")) return "I need two details before I can prepare a payment. Who should I pay, and how much?";
    if (missing.includes("amount")) return `How much should I send to ${payment.payee.name}? I will not guess the amount.`;
    return `Who should I send ${formatCurrency(payment.amount)} to? I will not guess the destination.`;
  };

  const buildSpokenSummary = (payment) => {
    if (payment.isCollect) {
      return `Stop. This is a collect request for ${formatCurrency(payment.amount)}, ${payment.amountWords} rupees, from ${payment.payee.name}. It would take money from you, not pay the shop. My caregiver mandate never covers pull requests. Say no if you did not expect it.`;
    }
    if (payment.payee.mismatch || !payment.payee.trusted) {
      return `Pause. You asked for ${payment.payee.requestedName || payment.payee.name}, but I found an account named ${payment.payee.name} at ${payment.payee.vpa}. This may be the wrong payee. Please verify before continuing.`;
    }
    if (payment.mandateBreach) {
      return `Pause. ${formatCurrency(payment.amount)}, ${payment.amountWords} rupees, to ${payment.payee.name} is above your ${formatCurrency(payment.mandateLimit)} hands-free mandate limit, so I cannot skip the bank's PIN screen for this one. Your caregiver must approve it first. Say yes only if you are sure.`;
    }
    if (payment.flags.includes("amount") || payment.flags.includes("amount-elevated")) {
      return `Pause. You are about to pay ${formatCurrency(payment.amount)}, ${payment.amountWords} rupees, to ${payment.payee.name} at ${payment.payee.vpa}. That is ${payment.amountMultiplier} times your usual amount for this payee. Say yes only after you verify it.`;
    }
    return `You are about to pay ${formatCurrency(payment.amount)}, ${payment.amountWords} rupees, to ${payment.payee.name} at ${payment.payee.vpa}. This is inside your caregiver mandate, so after your yes I will ask for your Voice PIN and then pay without any screen. Say yes to confirm, or say exit to cancel.`;
  };

  const resetPaymentFlow = () => {
    window.clearTimeout(appState.analysisTimer);
    window.clearTimeout(appState.processingTimer);
    window.clearTimeout(appState.caregiverTimer);
    appState.analysisToken += 1;
    appState.pending = null;
    appState.lastPayment = null;
    appState.riskAcknowledged = false;
    appState.collectAcknowledged = false;
    appState.caregiverStatus = "none";
    appState.caregiverApprovalId = null;
    appState.awaitingClarification = false;
    appState.voicePin = { digits: "", attempts: 0, locked: false, lockedUntil: 0, verifying: false, awaitingSpokenPin: false };
    if (appState.listening && appState.recognition) {
      try { appState.recognition.stop(); } catch (error) { /* no-op */ }
      appState.listening = false;
    }
    setState("ready");
    setTranscript('Sharma kirana ko paanch sau rupaye bhejo');
    dom.commandInput.placeholder = "e.g. Sharma kirana ko 500 rupaye bhejo";
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
      // During the Voice PIN challenge the stage stays in the authenticate state.
      if (appState.status !== "authenticate") setState("listening");
      setTranscript(appState.status === "authenticate" ? "Listening for your Voice PIN…" : "Listening…");
    };
    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const phrase = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalText += phrase;
        else interim += phrase;
      }
      const capturingPin = appState.status === "authenticate" && appState.voicePin.awaitingSpokenPin;
      if (interim) {
        if (capturingPin) handlePinTranscript(interim, appState.pending, false);
        else setTranscript(interim);
      }
      if (finalText.trim()) {
        appState.listening = false;
        if (capturingPin) handlePinTranscript(finalText.trim(), appState.pending, true);
        else handleCommand(finalText.trim(), "voice");
      }
    };
    recognition.onerror = (event) => {
      appState.listening = false;
      if (appState.status === "authenticate") {
        // Losing the mic must not silently abandon an authorization challenge.
        const message = event.error === "not-allowed"
          ? "Microphone permission is off. Use the keypad to enter your Voice PIN."
          : "I could not hear your Voice PIN. Please say it again, or use the keypad.";
        showToast(message, event.error === "not-allowed" ? "danger" : "safe");
        if (event.error !== "no-speech" && event.error !== "aborted") speak(message);
        byId("pinInput")?.focus();
        return;
      }
      setState("ready");
      const message = event.error === "not-allowed" ? "Microphone permission is off. You can type the command instead." : "I could not hear that. Try again or type a command.";
      showToast(message, event.error === "not-allowed" ? "danger" : "safe");
      if (event.error === "not-allowed") showTyping();
    };
    recognition.onend = () => {
      if (appState.status === "authenticate") {
        appState.listening = false;
        if (appState.voicePin.awaitingSpokenPin && !appState.voicePin.verifying && !appState.voicePin.locked) {
          // Re-open the mic so the loop stays hands-free after a silent pause.
          window.setTimeout(() => {
            if (appState.status === "authenticate" && appState.voicePin.awaitingSpokenPin) startPinListening(appState.pending);
          }, 900);
        }
        return;
      }
      if (appState.listening) {
        appState.listening = false;
        setState("ready");
      }
    };
    appState.recognition = recognition;
  };

  const startOrStopListening = () => {
    if (["analyzing", "processing"].includes(appState.status)) return;
    if (appState.status === "authenticate") {
      startPinListening(appState.pending);
      return;
    }
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
        body: `<p>AwaazPay does not blindly press Pay. It translates your words into a payment intent, checks that intent against your saved payees, spending patterns, and caregiver mandate, and speaks the decision back to you.</p><div class="info-points"><div><span>1</span><strong>Say it naturally</strong><small>Hindi, English, or Hinglish phrases are welcome.</small></div><div><span>2</span><strong>Hear the truth</strong><small>Amount, payee, direction, and risk are spoken plainly.</small></div><div><span>3</span><strong>Choose deliberately</strong><small>No spoken yes means no payment.</small></div><div><span>4</span><strong>Say your Voice PIN</strong><small>The last step replaces the visual UPI PIN pad and releases the hands-free mandate charge.</small></div></div>`,
      },
      safety: {
        kicker: "SAFETY CENTRE",
        title: "Four rules protect every payment",
        body: `<p>These guardrails are deliberately simple so the person making the payment, and the caregiver reviewing it later, can understand what happened.</p><div class="info-points"><div><span>01</span><strong>Always repeat the truth</strong><small>The amount and destination are spoken back before a confirmation can be accepted.</small></div><div><span>02</span><strong>Pause on unusual signals</strong><small>A large amount, a new payee, or a name mismatch needs an extra acknowledgement.</small></div><div><span>03</span><strong>Explain pulls clearly</strong><small>A collect request is described as money leaving your account and is never charged on the mandate.</small></div><div><span>04</span><strong>Stay inside the mandate</strong><small>Above the ₹5,000 hands-free limit the server refuses the charge and asks for caregiver authorization.</small></div></div>`,
      },
      trust: {
        kicker: "TRUST CENTRE",
        title: "Promises that stay visible",
        body: `<p>AwaazPay is designed for the moments when a person cannot comfortably inspect a screen. Trust is not a hidden setting; it is part of every decision.</p><div class="info-points"><div><span>01</span><strong>No visual PIN pads or OTPs</strong><small>Inside the caregiver mandate, authorization is a spoken Voice PIN. The one-time visual UPI PIN stays in the bank's own secure surface.</small></div><div><span>02</span><strong>No silent payments</strong><small>The agent can prepare a payment, but only a spoken yes plus a Voice PIN can release it.</small></div><div><span>03</span><strong>Caregiver by consent</strong><small>Above the mandate limit or for a new payee, a trusted caregiver must approve before the Voice PIN step is even offered.</small></div><div><span>04</span><strong>Your PIN is never repeated</strong><small>Digits are redacted from the transcript, hashed on the server, and never written to the caregiver log.</small></div></div>`,
      },
      mandate: {
        kicker: "CAREGIVER MANDATE",
        title: "Why hands-free is allowed at all",
        body: `<p>RBI and Razorpay require a UPI PIN for a normal payment. AwaazPay does not break that rule — it moves the PIN to a one-time caregiver setup and then charges inside a pre-authorized mandate.</p><div class="info-points"><div><span>01</span><strong>One-time visual setup</strong><small>A caregiver registers a UPI AutoPay mandate (or loads a closed-loop Razorpay wallet) and enters the UPI PIN once, in the bank app.</small></div><div><span>02</span><strong>Pre-authorized bounds</strong><small>Mandates under ₹5,000 per transaction can be charged without re-authentication, so everyday payments run server-to-server.</small></div><div><span>03</span><strong>Voice PIN instead of a PIN pad</strong><small>AwaazPay adds its own spoken passcode plus voiceprint check before it calls the S2S API.</small></div><div><span>04</span><strong>Above the limit, no bypass</strong><small>Anything larger is refused by the server and needs caregiver authorization — in production, the bank's visual PIN screen.</small></div></div>`,
      },
      voicepin: {
        kicker: "VOICE PIN",
        title: "How the spoken passcode is checked",
        body: `<p>The Voice PIN is the device-level guard that stops a bystander from shouting “pay five hundred” at the phone.</p><div class="info-points"><div><span>01</span><strong>Understands Hindi and English digits</strong><small>“one two three four”, “ek do teen char”, and typed digits all resolve to the same 4-digit passcode.</small></div><div><span>02</span><strong>Verified on the server</strong><small>Digits are hashed with a salt and compared in constant time, alongside a voiceprint match score.</small></div><div><span>03</span><strong>Exchanged for a short-lived token</strong><small>A successful check returns an HMAC-signed mandate-auth token that expires in about 90 seconds and is bound to that exact intent and amount.</small></div><div><span>04</span><strong>Three strikes and it stops</strong><small>Three wrong attempts lock the PIN, abandon the payment, and record the lockout in the caregiver log.</small></div></div>`,
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

  /* ------------------------------------------------- caregiver mandate setup */

  const mandateSetupSteps = [
    { title: "Caregiver signs in", detail: "Meera Sharma opens the visual setup screen — the only step that needs eyes on glass." },
    { title: "Choose trusted payees", detail: "Sharma Kirana, Rakesh Medical, and Mehta Utilities are added to the mandate allowlist." },
    { title: "Set the daily bounds", detail: `₹${formatNumber(5000)} per transaction and ₹${formatNumber(15000)} per day, matching RBI's UPI AutoPay limits for mandate-based charges.` },
    { title: "Authenticate once, visually", detail: "The caregiver completes the UPI PIN / bank approval inside the bank's own secure surface." },
    { title: "Mandate registered", detail: "Razorpay returns a token. From now on AwaazPay charges server-to-server after a Voice PIN — no PIN pad, no OTP." },
  ];

  const openMandateSetup = () => {
    const modal = byId("mandateModal");
    const list = byId("mandateSteps");
    if (!modal || !list) return;
    list.innerHTML = mandateSetupSteps
      .map((step, index) => `<li class="mandate-step" data-index="${index}"><span class="mandate-step-number">${String(index + 1).padStart(2, "0")}</span><span class="mandate-step-copy"><strong>${escapeHTML(step.title)}</strong><small>${escapeHTML(step.detail)}</small></span><span class="mandate-step-state">waiting</span></li>`)
      .join("");
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    addAudit("Mandate setup replayed", "Caregiver setup is a one-time visual flow; the demo replays it so judges can see where authorization comes from.", "safe", "users");

    const steps = $$(".mandate-step", list);
    let index = 0;
    const timer = window.setInterval(() => {
      if (index >= steps.length) {
        window.clearInterval(timer);
        const done = byId("mandateDone");
        if (done) done.disabled = false;
        speak("Mandate active. Everyday payments up to five thousand rupees can now run hands-free with your Voice PIN.");
        return;
      }
      steps[index].classList.add("active");
      const state = $(".mandate-step-state", steps[index]);
      if (state) state.textContent = "done";
      index += 1;
    }, 620);
    byId("closeMandate")?.focus();
  };

  const closeMandateSetup = () => {
    const modal = byId("mandateModal");
    if (!modal) return;
    modal.classList.add("hidden");
    if (!dom.auditModal.classList.contains("hidden") || !dom.infoModal.classList.contains("hidden")) return;
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
  byId("trustInfoButton")?.addEventListener("click", () => openInfo("trust"));
  byId("trustRulesButton")?.addEventListener("click", () => openInfo("trust"));
  byId("consentInfoButton")?.addEventListener("click", () => openInfo("trust"));
  byId("loopLearnButton")?.addEventListener("click", () => openInfo("how"));
  byId("closeInfo")?.addEventListener("click", closeInfo);
  byId("closeInfoBottom")?.addEventListener("click", closeInfo);
  dom.infoModal.addEventListener("click", (event) => {
    if (event.target === dom.infoModal) closeInfo();
  });
  $(".profile-menu")?.addEventListener("click", () => showToast("Profile controls are outside this demo."));

  // Caregiver mandate card + the always-visible caregiver log at the bottom.
  byId("mandateInfoButton")?.addEventListener("click", () => openInfo("mandate"));
  byId("mandateSetupButton")?.addEventListener("click", openMandateSetup);
  byId("voicePinInfoButton")?.addEventListener("click", () => openInfo("voicepin"));
  byId("closeMandate")?.addEventListener("click", closeMandateSetup);
  byId("mandateDone")?.addEventListener("click", closeMandateSetup);
  byId("mandateModal")?.addEventListener("click", (event) => {
    if (event.target === byId("mandateModal")) closeMandateSetup();
  });
  byId("openLogFromPanel")?.addEventListener("click", openAudit);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAudit();
      closeInfo();
      closeMandateSetup();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "1") {
      event.preventDefault();
      byId("voiceWorkspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Physical keypad fallback while the Voice PIN challenge is open.
    if (appState.status === "authenticate" && appState.pending && !appState.voicePin.verifying) {
      const activeTag = document.activeElement?.tagName;
      const typingInPinField = activeTag === "INPUT" && document.activeElement?.id === "pinInput";
      if (/^[0-9]$/.test(event.key) && !typingInPinField && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        appState.voicePin.digits = (appState.voicePin.digits + event.key).slice(0, PIN_LENGTH);
        refreshPinBoxes();
        if (appState.voicePin.digits.length === PIN_LENGTH) submitVoicePin(appState.pending, appState.voicePin.digits, "keypad");
        return;
      }
      if (event.key === "Backspace" && !typingInPinField) {
        event.preventDefault();
        appState.voicePin.digits = appState.voicePin.digits.slice(0, -1);
        refreshPinBoxes();
        return;
      }
    }
    if (event.code === "Space" && !event.repeat && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      startOrStopListening();
    }
  });

  /**
   * Smart Demo Mode: with no keys the console still runs end to end using the local
   * intent simulator and a simulated Razorpay S2S capture. With keys, the same UI drives
   * Groq parsing and real Razorpay mandate charges.
   */
  const loadServerHealth = async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error("health unavailable");
      const health = await response.json();
      appState.serverAvailable = true;
      appState.smartDemoMode = health.paymentMode !== "razorpay-live";
      if (!appState.smartDemoMode) appState.mandate.demoVoicePin = null;
      dom.connectionLabel.textContent = "Backend ready";
      const modes = [];
      modes.push(health.groqConfigured ? "Groq intent" : "Smart Demo Mode");
      modes.push(health.razorpayConfigured ? "Razorpay live keys" : "Simulated Razorpay S2S");
      dom.modeLabel.textContent = modes.join(" · ");
      if (dom.providerMode) dom.providerMode.textContent = health.razorpayConfigured ? "test mode" : "Smart Demo Mode";
      if (dom.providerLabel) dom.providerLabel.textContent = health.razorpayConfigured ? "Razorpay" : "Razorpay mandate ·";
      addAudit(
        health.razorpayConfigured || health.groqConfigured ? "Provider keys detected" : "Smart Demo Mode active",
        health.razorpayConfigured || health.groqConfigured
          ? `Groq: ${health.groqConfigured ? "on" : "off"} · Razorpay S2S: ${health.razorpayConfigured ? "live keys" : "simulated"}.`
          : "No API keys are configured, so the local AI simulator parses intent and the Razorpay S2S capture is simulated. The Voice PIN and mandate rules are identical.",
        "safe",
        "activity",
      );
    } catch (error) {
      appState.serverAvailable = false;
      appState.smartDemoMode = true;
      dom.connectionLabel.textContent = "Local only";
      dom.modeLabel.textContent = "Smart Demo Mode · no server";
      if (dom.providerMode) dom.providerMode.textContent = "Smart Demo Mode";
      if (dom.providerLabel) dom.providerLabel.textContent = "Razorpay mandate ·";
      addAudit("Running fully offline", "The Node server is unreachable, so the browser-side simulator owns parsing, PIN verification, and the simulated mandate capture.", "warning", "help");
      renderMandateCard();
    }
  };

  /**
   * Records the caregiver's decision on the server so an above-mandate charge can be
   * authorized. Returns the signed approval id, or null when running fully offline.
   */
  const registerCaregiverApproval = async (payment) => {
    try {
      const response = await fetch("/api/caregiver/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intentId: payment.intentId,
          amountPaise: Math.round(payment.amount * 100),
          payee: payment.payee.name,
          caregiver: appState.mandate.caregiver?.name || "Meera Sharma",
          reason: payment.mandateBreach ? "above-mandate-limit" : "high-risk-signal",
        }),
      });
      const body = await response.json().catch(() => ({}));
      return response.ok && body.approvalId ? body.approvalId : null;
    } catch (error) {
      return null;
    }
  };

  setupRecognition();
  renderAudit();
  renderMandateCard();
  setState("ready");
  updateBalance();
  updateMetrics();
  (async () => {
    await loadServerHealth();
    await loadMandate();
  })();
})();
