// Коды ошибок контрактного PR этапа 7 (W7.00, 0.12.0-stage7): в конце реестра api/errors.yaml, после offer_closed.
// Тесты прежних стюардов вычитают их из счёта кодов своего этапа (только добавление).
export const STAGE7_CODES = [
  'chat_ephemeral_disabled',
  'document_locked',
  'range_protected',
  'formula_invalid',
  'job_in_progress',
  'file_password_protected',
  'sign_code_invalid',
  'service_assignee_out_of_scope',
];
