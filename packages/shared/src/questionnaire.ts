import type {
  AnswerPrimitive,
  QuestionnaireQuestion,
} from './schemas.js';

export interface AnswerValidationResult {
  valid: boolean;
  normalizedValue: AnswerPrimitive;
  error?: string;
}

export interface QuestionnaireProgress {
  activeQuestions: QuestionnaireQuestion[];
  answeredQuestions: QuestionnaireQuestion[];
  missingRequiredQuestions: QuestionnaireQuestion[];
  missingOptionalQuestions: QuestionnaireQuestion[];
  nextRecommendedQuestion: QuestionnaireQuestion | null;
  isComplete: boolean;
}

const DEFAULT_PLAYER_TAG_REGEX = /^#[A-Z0-9]{3,16}$/;

export const UNAVAILABLE_ANSWER_PREFIX = '[Unavailable]';

const UNAVAILABLE_INTENT_REGEX =
  /\b(?:i\s*don['’]?t\s*have|dont\s*have|do\s*not\s*have|haven['’]?t\s*got|dont\s*got|i\s*don['’]?t\s*got|i\s*have\s*no|don['’]?t\s*know|dont\s*know|idk|no\s*tag|without\s*(?:a\s*)?tag|don['’]?t\s*remember|dont\s*remember|can['’]?t\s*(?:check|open|find|get|access|log\s*in|remember|see)|cannot\s*(?:check|open|find|get|access|log\s*in|remember|see)|not\s*sure\s*(?:what|where|how)|lost\s*(?:my|access|the\s*account))\b/i;

export function formatUnavailableAnswer(
  detail = 'Opener said they do not have this right now'
): string {
  return `${UNAVAILABLE_ANSWER_PREFIX} ${detail}`;
}

export function isUnavailableAnswer(value: AnswerPrimitive | undefined): boolean {
  return typeof value === 'string' && value.startsWith(UNAVAILABLE_ANSWER_PREFIX);
}

/**
 * Detects when a player explicitly states they don't have, don't know, or can't check
 * the requested field (e.g. "i don't have", "idk", "can't open game rn").
 */
export function detectUnavailableResponseIntent(rawMessage: string): boolean {
  const trimmed = rawMessage.trim();
  if (!trimmed || trimmed.length > 180) {
    return false;
  }
  if (/#[A-Z0-9]{3,16}\b/i.test(trimmed)) {
    return false;
  }
  return UNAVAILABLE_INTENT_REGEX.test(trimmed);
}

/**
 * Evaluates whether a conditional question is currently applicable based on collected answers.
 */
export function isQuestionActive(
  question: QuestionnaireQuestion,
  answers: Record<string, AnswerPrimitive>
): boolean {
  if (!question.condition) {
    return true;
  }

  const { dependsOnKey, operator, value } = question.condition;
  const dependencyValue = answers[dependsOnKey];

  if (dependencyValue === undefined || dependencyValue === null || dependencyValue === '') {
    return operator === 'not_equals' && value !== undefined;
  }

  switch (operator) {
    case 'truthy':
      return Boolean(dependencyValue) && dependencyValue !== 'false' && dependencyValue !== 'no';
    case 'equals':
      return String(dependencyValue).toLowerCase() === String(value ?? '').toLowerCase();
    case 'not_equals':
      return String(dependencyValue).toLowerCase() !== String(value ?? '').toLowerCase();
    case 'contains':
      return String(dependencyValue)
        .toLowerCase()
        .includes(String(value ?? '').toLowerCase());
    default:
      return true;
  }
}

/**
 * Validates and normalizes an extracted or user-supplied answer against a question's type and rules.
 */
export function validateAnswerValue(
  question: QuestionnaireQuestion,
  rawInput: AnswerPrimitive
): AnswerValidationResult {
  if (rawInput === null || rawInput === undefined || String(rawInput).trim() === '') {
    return {
      valid: false,
      normalizedValue: null,
      error: question.required ? 'A response is required for this field.' : undefined,
    };
  }

  if (isUnavailableAnswer(rawInput)) {
    return {
      valid: true,
      normalizedValue: String(rawInput).trim(),
    };
  }

  const customErr = question.validation?.customError;
  let normalized: AnswerPrimitive = rawInput;

  switch (question.type) {
    case 'player_tag': {
      let tag = String(rawInput).trim().toUpperCase().replace(/\s+/g, '');
      if (!tag.startsWith('#')) {
        tag = `#${tag}`;
      }
      const pattern = question.validation?.regex
        ? new RegExp(question.validation.regex, 'i')
        : DEFAULT_PLAYER_TAG_REGEX;
      if (!pattern.test(tag)) {
        return {
          valid: false,
          normalizedValue: null,
          error:
            customErr ??
            'Invalid player tag format (expected format like #ABC123 using alphanumeric tag characters).',
        };
      }
      normalized = tag;
      break;
    }

    case 'number': {
      const cleaned = typeof rawInput === 'number' ? rawInput : Number(String(rawInput).replace(/,/g, '').trim());
      if (Number.isNaN(cleaned) || !Number.isFinite(cleaned)) {
        return {
          valid: false,
          normalizedValue: null,
          error: customErr ?? 'Expected a valid numeric value.',
        };
      }
      if (question.validation?.min !== undefined && cleaned < question.validation.min) {
        return {
          valid: false,
          normalizedValue: null,
          error: customErr ?? `Value must be at least ${question.validation.min}.`,
        };
      }
      if (question.validation?.max !== undefined && cleaned > question.validation.max) {
        return {
          valid: false,
          normalizedValue: null,
          error: customErr ?? `Value must be at most ${question.validation.max}.`,
        };
      }
      normalized = cleaned;
      break;
    }

    case 'boolean': {
      if (typeof rawInput === 'boolean') {
        normalized = rawInput;
      } else {
        const lower = String(rawInput).trim().toLowerCase();
        if (['true', 'yes', 'y', '1', 'yeah', 'yep', 'affirmative'].includes(lower)) {
          normalized = true;
        } else if (['false', 'no', 'n', '0', 'nope', 'negative'].includes(lower)) {
          normalized = false;
        } else {
          return {
            valid: false,
            normalizedValue: null,
            error: customErr ?? 'Expected a yes or no answer.',
          };
        }
      }
      break;
    }

    case 'choice': {
      const text = String(rawInput).trim();
      if (question.choices && question.choices.length > 0) {
        const matched = question.choices.find(
          (choice) => choice.toLowerCase() === text.toLowerCase()
        );
        if (!matched) {
          return {
            valid: false,
            normalizedValue: null,
            error:
              customErr ??
              `Must match one of the allowed options: ${question.choices.join(', ')}.`,
          };
        }
        normalized = matched;
      } else {
        normalized = text;
      }
      break;
    }

    case 'date': {
      const text = String(rawInput).trim();
      const parsedTime = Date.parse(text);
      if (Number.isNaN(parsedTime)) {
        return {
          valid: false,
          normalizedValue: null,
          error: customErr ?? 'Expected a valid date (e.g., YYYY-MM-DD).',
        };
      }
      normalized = new Date(parsedTime).toISOString().slice(0, 10);
      break;
    }

    case 'text':
    case 'long_text': {
      const text = String(rawInput).trim();
      const minLen = question.validation?.minLength ?? (question.type === 'long_text' ? 5 : 1);
      const maxLen = question.validation?.maxLength ?? (question.type === 'long_text' ? 4000 : 500);
      if (text.length < minLen) {
        return {
          valid: false,
          normalizedValue: null,
          error: customErr ?? `Please provide a slightly more detailed answer (at least ${minLen} characters).`,
        };
      }
      if (text.length > maxLen) {
        return {
          valid: false,
          normalizedValue: null,
          error: customErr ?? `Answer exceeds maximum length of ${maxLen} characters.`,
        };
      }
      if (question.validation?.regex) {
        const regex = new RegExp(question.validation.regex);
        if (!regex.test(text)) {
          return {
            valid: false,
            normalizedValue: null,
            error: customErr ?? 'Answer did not match the expected format.',
          };
        }
      }
      normalized = text;
      break;
    }
  }

  return {
    valid: true,
    normalizedValue: normalized,
  };
}

/**
 * Computes which active questions are answered, which required/optional questions remain,
 * and whether sufficient information has been collected to prepare a moderator report.
 */
export function evaluateQuestionnaireProgress(
  questions: QuestionnaireQuestion[],
  validAnswers: Record<string, AnswerPrimitive>
): QuestionnaireProgress {
  const activeQuestions = questions.filter((q) => isQuestionActive(q, validAnswers));

  const answeredQuestions: QuestionnaireQuestion[] = [];
  const missingRequiredQuestions: QuestionnaireQuestion[] = [];
  const missingOptionalQuestions: QuestionnaireQuestion[] = [];

  for (const q of activeQuestions) {
    const val = validAnswers[q.key];
    const hasAnswer = val !== undefined && val !== null && String(val).trim() !== '';
    if (hasAnswer) {
      answeredQuestions.push(q);
    } else if (q.required) {
      missingRequiredQuestions.push(q);
    } else {
      missingOptionalQuestions.push(q);
    }
  }

  const nextRecommendedQuestion =
    missingRequiredQuestions[0] ?? missingOptionalQuestions[0] ?? null;

  return {
    activeQuestions,
    answeredQuestions,
    missingRequiredQuestions,
    missingOptionalQuestions,
    nextRecommendedQuestion,
    isComplete: missingRequiredQuestions.length === 0,
  };
}
