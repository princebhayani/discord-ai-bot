import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  AiTurnResponseSchema,
  ALLOWED_CHANNEL_PERMISSIONS,
  assertLeastPrivilegePermissions,
  buildLeastPrivilegeBotInviteUrl,
  evaluateQuestionnaireProgress,
  FORBIDDEN_PERMISSIONS,
  getGroqModelCapabilities,
  parseQuickDotCommands,
  QuestionnaireQuestionSchema,
  REQUIRED_PERMISSION_BITFIELD,
  sanitizeLogMetadata,
  sanitizeSensitiveContent,
  validateAnswerValue,
  type QuestionnaireQuestion,
} from './index.js';

describe('Phase 1: @hrbot/shared Foundation & Database Schema', () => {
  it('validates and normalizes all supported questionnaire types', () => {
    const tagQ: QuestionnaireQuestion = QuestionnaireQuestionSchema.parse({
      key: 'player_tag',
      question: 'What is your player tag?',
      type: 'player_tag',
      required: true,
    });
    expect(validateAnswerValue(tagQ, 'pyl098').valid).toBe(true);
    expect(validateAnswerValue(tagQ, 'pyl098').normalizedValue).toBe('#PYL098');
    expect(validateAnswerValue(tagQ, '#ABC123').normalizedValue).toBe('#ABC123');
    expect(validateAnswerValue(tagQ, 'not-a-tag!').valid).toBe(false);

    const numQ: QuestionnaireQuestion = QuestionnaireQuestionSchema.parse({
      key: 'town_hall',
      question: 'Town Hall level?',
      type: 'number',
      required: true,
      validation: { min: 1, max: 17 },
    });
    expect(validateAnswerValue(numQ, '16').normalizedValue).toBe(16);
    expect(validateAnswerValue(numQ, '99').valid).toBe(false);

    const boolQ: QuestionnaireQuestion = QuestionnaireQuestionSchema.parse({
      key: 'was_leader',
      question: 'Were you an elder or co-leader?',
      type: 'boolean',
      required: true,
    });
    expect(validateAnswerValue(boolQ, 'yes').normalizedValue).toBe(true);
    expect(validateAnswerValue(boolQ, 'nope').normalizedValue).toBe(false);

    const choiceQ: QuestionnaireQuestion = QuestionnaireQuestionSchema.parse({
      key: 'urgency',
      question: 'Urgency?',
      type: 'choice',
      required: true,
      choices: ['Low', 'Normal', 'High'],
    });
    expect(validateAnswerValue(choiceQ, 'high').normalizedValue).toBe('High');
    expect(validateAnswerValue(choiceQ, 'critical').valid).toBe(false);

    const dateQ: QuestionnaireQuestion = QuestionnaireQuestionSchema.parse({
      key: 'incident_date',
      question: 'When did this happen?',
      type: 'date',
      required: true,
    });
    expect(validateAnswerValue(dateQ, '2026-10-29').normalizedValue).toBe('2026-10-29');
  });

  it('evaluates conditional questions and completion progress accurately', () => {
    const questions: QuestionnaireQuestion[] = [
      QuestionnaireQuestionSchema.parse({
        key: 'in_clan',
        question: 'Are you currently in a clan?',
        type: 'boolean',
        required: true,
      }),
      QuestionnaireQuestionSchema.parse({
        key: 'clan_name',
        question: 'Which clan are you in?',
        type: 'text',
        required: true,
        condition: { dependsOnKey: 'in_clan', operator: 'equals', value: true },
      }),
      QuestionnaireQuestionSchema.parse({
        key: 'extra_notes',
        question: 'Any extra notes?',
        type: 'long_text',
        required: false,
      }),
    ];

    const step1 = evaluateQuestionnaireProgress(questions, { in_clan: false });
    expect(step1.isComplete).toBe(true);
    expect(step1.missingRequiredQuestions).toHaveLength(0);

    const step2 = evaluateQuestionnaireProgress(questions, { in_clan: true });
    expect(step2.isComplete).toBe(false);
    expect(step2.missingRequiredQuestions.map((q) => q.key)).toEqual(['clan_name']);
  });

  it('validates structured AI turn responses via Zod', () => {
    const parsed = AiTurnResponseSchema.parse({
      reply: "Thanks! I'll check your profile.",
      extractedAnswers: {
        player_tag: '#PYL928',
        clan_name: 'BOOM',
      },
      missingFields: ['issue'],
      requestedAction: 'lookup_player',
      lookupTarget: '#PYL928',
      complete: false,
    });
    expect(parsed.requestedAction).toBe('lookup_player');
    expect(() =>
      AiTurnResponseSchema.parse({
        reply: '',
        requestedAction: 'delete_channel',
      })
    ).toThrow();
  });

  it('redacts passwords, recovery codes, API keys, and log conversation text', () => {
    const sample =
      'My password is superSecret123 and recovery code: ABCD-EFGH-1234 and gsk_1234567890abcdefghijklmnop';
    const res = sanitizeSensitiveContent(sample);
    expect(res.redacted).toBe(true);
    expect(res.sanitizedText).not.toContain('superSecret123');
    expect(res.sanitizedText).not.toContain('ABCD-EFGH-1234');
    expect(res.sanitizedText).not.toContain('gsk_1234567890abcdefghijklmnop');

    const safeLog = sanitizeLogMetadata({
      sessionId: 'abc',
      content: 'private player message',
      GROQ_API_KEY: 'secret',
    });
    expect(safeLog.sessionId).toBe('abc');
    expect(safeLog.content).toBe('[REDACTED]');
    expect(safeLog.GROQ_API_KEY).toBe('[REDACTED]');
  });

  it('enforces least-privilege Discord permissions and blocks ticket-management flags', () => {
    expect(() => assertLeastPrivilegePermissions(REQUIRED_PERMISSION_BITFIELD)).not.toThrow();
    expect(() =>
      assertLeastPrivilegePermissions(
        ALLOWED_CHANNEL_PERMISSIONS.ViewChannel | FORBIDDEN_PERMISSIONS.ManageChannels
      )
    ).toThrow(/ManageChannels/);
    expect(() =>
      assertLeastPrivilegePermissions(FORBIDDEN_PERMISSIONS.ManageThreads)
    ).toThrow(/ManageThreads/);
    expect(() =>
      assertLeastPrivilegePermissions(FORBIDDEN_PERMISSIONS.CreatePrivateThreads)
    ).toThrow(/CreatePrivateThreads/);

    const inviteUrl = buildLeastPrivilegeBotInviteUrl('123456789012345678');
    expect(inviteUrl).toContain('permissions=' + REQUIRED_PERMISSION_BITFIELD.toString());
  });

  it('resolves Groq model capabilities without hardcoding business logic to a single model', () => {
    expect(getGroqModelCapabilities('openai/gpt-oss-20b').supportsStrictJsonSchema).toBe(true);
    expect(getGroqModelCapabilities('llama-3.3-70b-versatile').supportsJsonObject).toBe(true);
    expect(getGroqModelCapabilities('custom-org/future-model').supportsJsonObject).toBe(true);
  });

  it('verifies SQL migrations define all 8 required tables, RLS policies, and cascade cleanup', () => {
    const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
    const sql1 = fs.readFileSync(path.join(migrationsDir, '0001_initial_schema.sql'), 'utf8');
    const sql2 = fs.readFileSync(path.join(migrationsDir, '0002_rls_and_cleanup.sql'), 'utf8');

    const requiredTables = [
      'server_settings',
      'ticket_category_configs',
      'ticket_sessions',
      'ticket_messages',
      'ticket_answers',
      'player_lookups',
      'staff_reports',
      'dashboard_admins',
    ];

    for (const table of requiredTables) {
      expect(sql1).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(sql2).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
    }

    expect(sql2).toContain('cleanup_closed_ticket_session');
  });

  it('parses 1-line DOT command definitions cleanly and rejects command injection', () => {
    const simple = parseQuickDotCommands('.p {tag}');
    expect(simple.valid).toBe(true);
    expect(simple.commandPrefix).toBe('.');
    expect(simple.supportedActions).toEqual(['lookup_player']);
    expect(simple.commandTemplates.lookup_player).toBe('{prefix}p {target}');
    expect(simple.previews.lookup_player).toBe('.p #9RQU2YQPL');

    const withExampleTag = parseQuickDotCommands('.player #9RQU2YQPL');
    expect(withExampleTag.valid).toBe(true);
    expect(withExampleTag.commandTemplates.lookup_player).toBe('{prefix}player {target}');
    expect(withExampleTag.previews.lookup_player).toBe('.player #9RQU2YQPL');

    const bareCommand = parseQuickDotCommands('.p');
    expect(bareCommand.valid).toBe(true);
    expect(bareCommand.commandTemplates.lookup_player).toBe('{prefix}p {target}');

    const multi = parseQuickDotCommands('.p {tag}, .clan {clan}');
    expect(multi.valid).toBe(true);
    expect(multi.supportedActions).toEqual(['lookup_player', 'lookup_clan']);
    expect(multi.previews.lookup_clan).toBe('.clan #2PP');

    const bad = parseQuickDotCommands('.p @everyone');
    expect(bad.valid).toBe(false);
  });
});
