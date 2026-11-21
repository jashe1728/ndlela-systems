export const LEAD_TOOL_NAME = 'prepare_workflow_handoff';

function clampText(value, maxLen, fallback) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

/**
 * Return the OpenAI Responses API strict function tool definition for lead handoff.
 */
export function getLeadToolDefinition(clientConfig) {
  const owner = clientConfig?.founder || clientConfig?.brandName || 'the team';
  return {
    type: 'function',
    name: LEAD_TOOL_NAME,
    description: `Prepare a structured Workflow Review handoff brief and pre-filled WhatsApp/LinkedIn contact links for ${owner}. Call this when the visitor wants to start a Workflow Review, asks to contact ${owner}, or shares a concrete business bottleneck to discuss.`,
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: [
        'language',
        'visitor_name',
        'business_name',
        'bottleneck',
        'current_tools',
        'desired_outcome'
      ],
      properties: {
        language: {
          type: 'string',
          enum: ['en', 'pt'],
          description: 'Language matching the visitor latest message ("en" or "pt").'
        },
        visitor_name: {
          type: 'string',
          description: 'Visitor name if given, otherwise "Not provided" or "Não indicado".'
        },
        business_name: {
          type: 'string',
          description: 'Business or company name if given, otherwise "Not provided" or "Não indicado".'
        },
        bottleneck: {
          type: 'string',
          description: 'Concise summary of the manual process, handoff issue, or operational friction.'
        },
        current_tools: {
          type: 'string',
          description: 'Existing tools, spreadsheets, or software mentioned, or "Not specified".'
        },
        desired_outcome: {
          type: 'string',
          description: 'What outcome or improvement the visitor wants, or "Exploratory Workflow Review".'
        }
      }
    }
  };
}

/**
 * Normalize captured tool arguments and build pre-filled WhatsApp / LinkedIn handoff links.
 */
export function buildHandoffPayload(rawArgs, clientConfig) {
  const lang = String(rawArgs?.language || '').toLowerCase().startsWith('pt') ? 'pt' : 'en';
  const brandName = clientConfig?.brandName || 'Ndlela Systems';
  const founder = clientConfig?.founder || brandName;
  const founderFirstName = founder.split(/\s+/)[0] || brandName;

  const defaultMissing = lang === 'pt' ? 'Não indicado' : 'Not provided';
  const defaultTools = lang === 'pt' ? 'Não especificado' : 'Not specified';
  const defaultBottleneck = lang === 'pt' ? 'Melhoria de fluxo de trabalho' : 'Workflow improvement enquiry';
  const defaultOutcome = lang === 'pt' ? 'Revisão de Fluxo exploratória' : 'Exploratory Workflow Review';

  const visitorName = clampText(rawArgs?.visitor_name, 120, defaultMissing);
  const businessName = clampText(rawArgs?.business_name, 120, defaultMissing);
  const bottleneck = clampText(rawArgs?.bottleneck, 350, defaultBottleneck);
  const currentTools = clampText(rawArgs?.current_tools, 180, defaultTools);
  const desiredOutcome = clampText(rawArgs?.desired_outcome, 240, defaultOutcome);

  const summaryText =
    lang === 'pt'
      ? [
          `Olá ${founderFirstName}, vim pelo site da ${brandName} para conversar sobre uma Revisão de Fluxo:`,
          `- Nome: ${visitorName}`,
          `- Empresa: ${businessName}`,
          `- Problema / gargalo: ${bottleneck}`,
          `- Ferramentas atuais: ${currentTools}`,
          `- Objetivo: ${desiredOutcome}`
        ].join('\n')
      : [
          `Hi ${founderFirstName}, I'm reaching out from the ${brandName} website for a Workflow Review:`,
          `- Name: ${visitorName}`,
          `- Business: ${businessName}`,
          `- Bottleneck: ${bottleneck}`,
          `- Current tools: ${currentTools}`,
          `- Desired outcome: ${desiredOutcome}`
        ].join('\n');

  const whatsappDigits = String(clientConfig?.contact?.whatsappNumber || '351910058371').replace(/\D+/g, '');
  const whatsappUrl = `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(summaryText)}`;
  const linkedinUrl = clientConfig?.contact?.linkedinUrl || 'https://www.linkedin.com/company/ndlelasystems/';

  return {
    language: lang,
    visitorName,
    businessName,
    bottleneck,
    currentTools,
    desiredOutcome,
    summaryText,
    whatsappUrl,
    linkedinUrl
  };
}
