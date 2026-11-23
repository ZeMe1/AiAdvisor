import { DEFAULT_GUARDRAIL_CONFIG, guardrailConfigRepository } from '../repositories/guardrail-config.repository.mjs';

const CATEGORY_PATTERNS = {
  medical: [
    /\b(medical|medicine|medication|doctor|physician|symptom|symptoms|fever|headache|cough|flu|diagnosis|diagnose|therapy|antibiotic|prescription|hospital|clinic|allergy|covid|surgery|pill|pills|dosage|ibuprofen|paracetamol|rash|sick|illness|disease|diabetes|mental health|depression|anxiety)\b/i,
    /(медицин|лекарств|таблетк|врач|доктор|больниц|симптом|температур|простуд|кашел|головн\S*\s+бол|диагноз|антибиотик|рецепт\S*\s+врач|болезн|заболел|болит\s+голо|лечени|дозировк|депресс)/i,
  ],
  politics: [
    /\b(politics|political|president|election|elections|parliament|government|senate|congress|minister|prime minister|political party|vote|voting|sanctions|geopolitics|war|diplomacy|democrat|republican|opposition)\b/i,
    /(политик|политическ|президент|выбор|парламент|правительств|министр|партия|голосова|санкци|геополитик|войн|дипломат|оппозиц)/i,
  ],
  legal: [
    /\b(legal|lawyer|attorney|lawsuit|sue|court|judge|contract law|visa law|immigration lawyer|arrest|police|criminal|litigation|custody|divorce|copyright law|legal advice)\b/i,
    /(юрист|адвокат|юридическ|правовой\s+совет|суд[аеу]?|иск\b|уголовн|полици|штраф|арест|развод|алимент|судебн)/i,
  ],
  personal: [
    /\b(girlfriend|boyfriend|dating|relationship advice|marriage|breakup|horoscope|astrology|zodiac|weight loss|diet plan|workout routine|pizza|recipe|cooking|lottery|casino|gambling|betting|crypto trading|bitcoin price)\b/i,
    /(девушк|парень|отношени|свидани|расставан|гороскоп|астролог|зодиак|диет|похуд|рецепт\s+пицц|приготовит|лотере|казино|ставки|ставк|личн\S*\s+жизн|биткоин)/i,
  ],
};

const SENSITIVE_PATTERNS = [
  // Credit / debit card numbers (13-19 digits, spaced or hyphenated)
  { type: 'payment', regex: /\b(?:\d[ -]*?){13,19}\b/g, replacement: '[REDACTED PAYMENT]' },
  // CVV / CVC / PIN codes
  { type: 'payment', regex: /\b(cvv|cvc|pin(?:\s*code)?)\s*(?:is|:|=)?\s*\d{3,6}\b/gi, replacement: '$1 [REDACTED]' },
  // Passwords (EN & RU)
  { type: 'password', regex: /\b(password|passwd|pwd)\s*(?:is|:|=)?\s*["']?[^\s,;]{3,}["']?/gi, replacement: '$1 [REDACTED]' },
  { type: 'password', regex: /(парол[ьяе]|пин-?код)\s*(?:это|:|=|-)?\s*["']?[^\s,;]{3,}["']?/gi, replacement: '$1 [REDACTED]' },
  // API keys / JWT tokens
  { type: 'secret', regex: /\b(AIza[0-9A-Za-z\-_]{20,}|sk-[0-9A-Za-z\-_]{20,}|gsk_[0-9A-Za-z\-_]{20,}|AQ\.[0-9A-Za-z._-]{20,})\b/g, replacement: '[REDACTED KEY]' },
];

const DEADLINE_OR_RULE_PATTERN =
  /\b(deadline|deadlines|last day|drop|add\/drop|add-drop|withdraw|withdrawal|official rule|official rules|university policy|academic calendar|expulsion|appeal|retake rule|tuition)\b|(дедлайн|последн\S*\s+ден|срок\S*\s+(?:сдачи|регистрац|отказа)|дроп|отказ\S*\s+от\s+курса|отчислен|официальн\S*\s+правил|академ\S*\s+календар|апелляц)/i;

export class GuardrailService {
  detectLanguage(text) {
    return /[а-яёА-ЯЁ]/.test(String(text || '')) ? 'ru' : 'en';
  }

  /**
   * Masks passwords, payment card details, CVVs, and API keys from any input or output text.
   */
  redactSensitiveData(text) {
    let out = String(text || '');
    let redacted = false;

    for (const rule of SENSITIVE_PATTERNS) {
      rule.regex.lastIndex = 0;
      if (rule.regex.test(out)) {
        redacted = true;
        rule.regex.lastIndex = 0;
        out = out.replace(rule.regex, rule.replacement);
      }
    }

    return { text: out, redacted };
  }

  hasSensitiveSecretSharingIntent(text) {
    const q = String(text || '').toLowerCase();
    return /\b(my password|save my password|credit card|card number|cvv|pay with card|bank card)\b|(мой пароль|сохрани пароль|номер карты|банковск\S* карт|оплат\S* карт)/i.test(q);
  }

  detectBlockedCategory(text, config = DEFAULT_GUARDRAIL_CONFIG) {
    const q = String(text || '');
    const enabledCategories = Array.isArray(config?.blocked_categories)
      ? config.blocked_categories
      : DEFAULT_GUARDRAIL_CONFIG.blocked_categories;

    // 1. Check configurable custom blocked keywords added by administrator
    const customKeywords = Array.isArray(config?.custom_blocked_keywords)
      ? config.custom_blocked_keywords
      : [];
    const lower = q.toLowerCase();
    for (const kw of customKeywords) {
      const cleanKw = String(kw || '').trim().toLowerCase();
      if (cleanKw && lower.includes(cleanKw)) {
        return { blocked: true, category: 'custom', matchedKeyword: cleanKw };
      }
    }

    // 2. Check standard sensitive/off-topic categories (politics, medical, legal, personal)
    for (const cat of enabledCategories) {
      const patterns = CATEGORY_PATTERNS[cat] || [];
      for (const p of patterns) {
        p.lastIndex = 0;
        if (p.test(q)) {
          return { blocked: true, category: cat };
        }
      }
    }

    return { blocked: false, category: null };
  }

  isOfficialRuleOrDeadlineQuery(query, replyText = '') {
    return DEADLINE_OR_RULE_PATTERN.test(`${query || ''} ${replyText || ''}`);
  }

  getRefusalMessage(lang, config = DEFAULT_GUARDRAIL_CONFIG, isSensitive = false) {
    if (isSensitive) {
      return lang === 'ru'
        ? 'В целях безопасности я не обрабатываю, не сохраняю и не повторяю пароли, номера банковских карт или платёжные данные. Пожалуйста, задайте академический вопрос по курсам или учебному плану!'
        : 'For your security, I cannot store, process, or repeat passwords, payment card details, or sensitive credentials. Please ask an academic question about your courses or study plan!';
    }
    return lang === 'ru'
      ? (config?.refusal_message_ru || DEFAULT_GUARDRAIL_CONFIG.refusal_message_ru)
      : (config?.refusal_message_en || DEFAULT_GUARDRAIL_CONFIG.refusal_message_en);
  }

  /**
   * Pre-execution input guardrail: redacts PII/secrets BEFORE storing logs & blocks forbidden categories.
   */
  moderateInput(rawQuery, config = DEFAULT_GUARDRAIL_CONFIG) {
    const lang = this.detectLanguage(rawQuery);
    const shouldRedact = config?.redact_sensitive_data !== false;
    const redaction = shouldRedact ? this.redactSensitiveData(rawQuery) : { text: String(rawQuery || ''), redacted: false };

    if (redaction.redacted || this.hasSensitiveSecretSharingIntent(rawQuery)) {
      return {
        blocked: true,
        category: 'sensitive_data',
        sanitizedQuery: redaction.text,
        refusalReply: this.getRefusalMessage(lang, config, true),
      };
    }

    const catCheck = this.detectBlockedCategory(rawQuery, config);
    if (catCheck.blocked) {
      return {
        blocked: true,
        category: catCheck.category,
        sanitizedQuery: redaction.text,
        refusalReply: this.getRefusalMessage(lang, config, false),
      };
    }

    return {
      blocked: false,
      category: null,
      sanitizedQuery: redaction.text,
      refusalReply: null,
    };
  }

  /**
   * Post-generation output guardrail: enforces PII redaction & attaches official disclaimer before displaying to user.
   */
  moderateOutput(rawReply, query, config = DEFAULT_GUARDRAIL_CONFIG) {
    let text = String(rawReply || '').trim();
    if (config?.redact_sensitive_data !== false) {
      text = this.redactSensitiveData(text).text;
    }

    const disclaimer = (config?.disclaimer_text || DEFAULT_GUARDRAIL_CONFIG.disclaimer_text).trim();
    if (this.isOfficialRuleOrDeadlineQuery(query, text)) {
      const hasDisclaimer = text.toLowerCase().includes(disclaimer.toLowerCase().replace(/\.$/, ''));
      if (!hasDisclaimer) {
        text = `${text}\n\n_${disclaimer}_`;
      }
    }

    return text;
  }

  async getConfig() {
    return guardrailConfigRepository.getActiveConfig();
  }

  async updateConfig(data, adminUsername) {
    return guardrailConfigRepository.createConfig(data, adminUsername);
  }

  async resetConfig(adminUsername) {
    return guardrailConfigRepository.resetToDefault(adminUsername);
  }
}

export const guardrailService = new GuardrailService();
