/**
 * Analytics & AI Assessment — scoring model.
 *
 * Ported verbatim from the standalone `analytics_ai_scoring_engine.html`
 * prototype. **The data below is the methodology.** Section weights,
 * question weights, keyword mappings, influencer points and penalty
 * tiers all determine the score a client sees in their assessment
 * output document.
 *
 * Treat changes here as changes to a published methodology, not as code
 * edits:
 *   - a score produced today should be reproducible tomorrow
 *   - two consultants scoring the same response must get the same number
 *   - `lib/scoring/__fixtures__` pins the reference output; if a change
 *     is intentional, update the fixture in the same commit and say why
 *
 * Keyword matching is substring-based and case-insensitive, and bands are
 * evaluated **last-to-first** so the most mature match wins when an answer
 * contains phrases from more than one band.
 */

export type SectionId = 'dfg' | 'ids' | 'air' | 'va';

export interface Section {
  id: SectionId;
  title: string;
  /** Share of the overall score. The four weights sum to 1. */
  weight: number;
  color: string;
  accent: string;
}

export interface Band {
  min: number;
  max: number;
  label: string;
  desc: string;
}

export interface OverallBand {
  min: number;
  max: number;
  label: string;
  color: string;
}

export interface SCurveStage {
  label: string;
  sub: string;
  min: number;
  max: number;
  color: string;
}

export interface BandMapping {
  match: string[];
  score: number;
}

export interface PositiveInfluencer {
  match: string[];
  points: number;
}

export type Severity = 'High' | 'Intermediate' | 'Basic';

export interface NegativeInfluencer {
  match: string[];
  points: number;
  severity: Severity;
}

interface BaseQuestion {
  key: string;
  section: SectionId;
  /** Share of its section's score. Weights within a section sum to 1. */
  weight: number;
  /** Leading text used to match the question in a pasted response. */
  question: string;
}

export interface BandQuestion extends BaseQuestion {
  type: 'band';
  mappings: BandMapping[];
}

export interface InfluencerQuestion extends BaseQuestion {
  type: 'influencer';
  positives: PositiveInfluencer[];
  negatives: NegativeInfluencer[];
}

export interface ToolPenaltyQuestion extends BaseQuestion {
  type: 'tool_penalty';
}

export type Question = BandQuestion | InfluencerQuestion | ToolPenaltyQuestion;

export const EXAMPLE_INPUT = `Name: Kermit T Frog
Company: Muppets Inc
Job Function: Executive/Senior Leadership
Email: k.frog@muppets.com
Which tools or applications does your business use for gaining insight on your data? Tick all that apply. Existing tools are a good way for us to help measure effectiveness against investment in technologies: Microsoft Excel
How consistent and standardised are your data preparation practices (eg collection and cleaning) across the business?: Very ad hoc, inconsistent, or manual processes
How well-connected and accessible is your data across systems for analytics and AI?: Data is siloed and difficult to access
How well do your reports, dashboards, and analytics support day-to-day and strategic decision-making in your business?: Reports are limited, inconsistent, and not trusted
How much trust and confidence do stakeholders have in data- or AI-generated insights and recommendations? Tick all that apply: Insights are rarely trusted for informing decisions, Insights are often challenged or ignored
How quickly can the business respond to changes or new priorities using your data and AI tools and processes? Tick all that apply: Each report build from scratch, Slow compared to business needs
How well is AI adoption aligned to your overall business strategy and goals?: No clear alignment — AI is explored in isolation
What stage is your organisation at in adopting AI tools into day-to-day business operations and decision-making?: No active use of AI in operations
How well is the use of AI tools (including generative AI) governed and managed across the organisation?: No policy or oversight
How capable is your organisation in developing, deploying, and maintaining AI solutions?: No in-house capability, reliant on external support
What impact has your data and AI capability had on cost savings, revenue opportunities, or efficiency gains?: No measurable impact yet
How well can your data and AI initiatives scale to meet growing business demand?: Cannot scale beyond pilot projects
How quickly can new data or AI solutions move from idea to implementation in your organisation?: Very slow — projects take years to implement`;

export const LEGACY_PRIMARY: string[] = ["microsoft excel","excel","sap crystal reports","crystal reports","microsoft ssrs","ssrs","sql server reporting services"];
export const LEGACY_SUPP: string[] = ["microsoft access","access"];
export const MODERN: string[] = ["power bi","tableau","qlik","looker","domo","thoughtspot","sap analytics cloud","sac","databricks","snowflake","microsoft fabric","fabric"];

export const SECTIONS: Section[] = [
  { id:"dfg", title:"Data Foundations & Governance", weight:0.30, color:"#0A4D68", accent:"#12A5C2" },
  { id:"ids", title:"Insight & Decision Support", weight:0.25, color:"#1B3A4B", accent:"#4ECDC4" },
  { id:"air", title:"AI Readiness & Use", weight:0.20, color:"#2D3047", accent:"#E76F51" },
  { id:"va",  title:"Value & Agility", weight:0.25, color:"#264653", accent:"#E9C46A" },
];

export const SECTION_BANDS: Record<SectionId, Band[]> = {
  dfg:[{min:0,max:20,label:"Critical Risk",desc:"Fragmented, unmanaged data; poor toolsets"},{min:20,max:40,label:"High Risk",desc:"Some structure, but tools undermine trust"},{min:40,max:60,label:"Basic Maturity",desc:"Foundations forming; governance fragile"},{min:60,max:80,label:"Governed at Scale",desc:"Standards embedded; consistent data use"},{min:80,max:100,label:"Strategic Foundation",desc:"Mature, automated governance"}],
  ids:[{min:0,max:20,label:"Minimal Use",desc:"Reporting not trusted or used"},{min:20,max:40,label:"Fragmented Adoption",desc:"Inconsistent use, low relevance"},{min:40,max:60,label:"Operationally Useful",desc:"Regular use, weak strategic alignment"},{min:60,max:80,label:"Insight-Driven",desc:"Supports most decisions strategically"},{min:80,max:100,label:"Decision-Centric",desc:"Deeply embedded in all decisions"}],
  air:[{min:0,max:20,label:"Experimental Only",desc:"Ad hoc, uncoordinated AI use"},{min:20,max:40,label:"Early Exploration",desc:"Siloed, limited governance or value"},{min:40,max:60,label:"Operational Piloting",desc:"Integrated in selected processes"},{min:60,max:80,label:"Embedded Capability",desc:"Aligned, generating value"},{min:80,max:100,label:"Strategic AI Use",desc:"Governed, trusted, driving innovation"}],
  va:[{min:0,max:20,label:"Low Value, Low Response",desc:"Little impact on outcomes"},{min:20,max:40,label:"Early Signs of Value",desc:"Limited agility, inconsistent results"},{min:40,max:60,label:"Operational Contribution",desc:"Measurable in parts, improving"},{min:60,max:80,label:"Consistent Value Creation",desc:"Reliably supports outcomes"},{min:80,max:100,label:"High-Impact & Agile",desc:"Drives measurable value at scale"}],
};

export const OVERALL_BANDS: OverallBand[] = [
  {min:0,max:20,label:"Reactive with Risks",color:"#C0392B"},
  {min:20,max:35,label:"Foundational Awareness",color:"#E67E22"},
  {min:35,max:50,label:"Emerging Insight",color:"#F39C12"},
  {min:50,max:70,label:"Proactive Performer",color:"#27AE60"},
  {min:70,max:85,label:"Integrated Value",color:"#2980B9"},
  {min:85,max:101,label:"Strategic Advantage",color:"#8E44AD"},
];

export const SCURVE: SCurveStage[] = [
  {label:"Reactive & Ad Hoc",sub:"Manual Processes",min:0,max:15,color:"#1B3A4B"},
  {label:"Reporting Aware",sub:"Non-AI Automation",min:15,max:30,color:"#264653"},
  {label:"Diagnostic Insight",sub:"Assistive AI",min:30,max:45,color:"#2A6F7B"},
  {label:"Predictive Insight",sub:"Decision Support AI",min:45,max:62,color:"#0A4D68"},
  {label:"Prescriptive Insight",sub:"Orchestrated AI",min:62,max:78,color:"#12A5C2"},
  {label:"Strategic Insight",sub:"Strategic AI",min:78,max:101,color:"#4ECDC4"},
];

export const QUESTIONS: Question[] = [
  {key:"data_prep",section:"dfg",weight:0.30,question:"How consistent and standardised are your data preparation practices",type:"band",
    mappings:[{match:["ad hoc","inconsistent","manual processes","no standards"],score:5},{match:["mostly manual","department-specific","some duplication"],score:18},{match:["standard practices emerging","emerging in some areas"],score:33},{match:["mostly consistent","some automation","limited documentation","consistent processes used across most","across most areas"],score:50},{match:["consistent, documented","cross-team","standardisation"],score:70},{match:["fully standardised","automated","governed end-to-end"],score:90}]},
  {key:"data_access",section:"dfg",weight:0.35,question:"How well-connected and accessible is your data across systems",type:"band",
    mappings:[{match:["siloed","difficult to access","manual exports","file sharing"],score:5},{match:["basic reporting integrations","excel pulling from"],score:18},{match:["analytics tools connect","no centralis"],score:38},{match:["data lake","doesn't fully meet","common sources integrated"],score:63},{match:["data pipelines","centralised location","structured for purpose"],score:83},{match:["fully integrated","predictive capabilities","data democratisation"],score:95}]},
  {key:"tool_penalty",section:"dfg",weight:0.35,question:"Which tools or applications does your business use",type:"tool_penalty"},
  {key:"decision_support",section:"ids",weight:0.35,question:"How well do your reports, dashboards, and analytics support",type:"band",
    mappings:[{match:["limited","inconsistent","not trusted","rarely used"],score:10},{match:["occasionally used","low trust","unclear alignment","useful for some decisions","lacks depth","lacks timeliness","lacks depth and timeliness"],score:30},{match:["supports day-to-day","limited strategic"],score:50},{match:["supports most decisions","reasonably aligned"],score:70},{match:["central to decision-making","across the organisation"],score:90}]},
  {key:"trust",section:"ids",weight:0.35,question:"How much trust and confidence do stakeholders have",type:"influencer",
    positives:[{match:["growing interest"],points:1},{match:["some teams rely on"],points:1},{match:["used consistently within certain departments","consistently within"],points:1},{match:["generally trusted","used to guide decisions"],points:1},{match:["widely adopted"],points:1},{match:["trusted and relied upon at all levels"],points:1}],
    negatives:[{match:["rarely trusted"],points:-3,severity:"High"},{match:["challenged or ignored"],points:-2,severity:"Intermediate"},{match:["concerns exist","accuracy or relevance"],points:-2,severity:"Intermediate"},{match:["limited to a few teams","specific people"],points:-1,severity:"Basic"}]},
  {key:"agility",section:"ids",weight:0.30,question:"How quickly can the business respond to changes",type:"influencer",
    positives:[{match:["some teams can respond quickly"],points:1},{match:["focus on agility","agility is growing"],points:1},{match:["processes are in place to support change"],points:1},{match:["fast, routine adjustments"],points:1},{match:["reusable assets"],points:1},{match:["self-serve"],points:1}],
    negatives:[{match:["large delays","face large delays","new requests face"],points:-3,severity:"High"},{match:["high manual effort"],points:-2,severity:"Intermediate"},{match:["built from scratch","build from scratch","from scratch"],points:-2,severity:"Intermediate"},{match:["slow compared"],points:-1,severity:"Basic"}]},
  {key:"ai_alignment",section:"air",weight:0.25,question:"How well is AI adoption aligned to your overall business strategy",type:"band",
    mappings:[{match:["no clear alignment","explored in isolation","in pockets","no link"],score:12},{match:["some alignment","opportunistic","siloed","ai initiatives exist","mostly experimental","initiatives exist but"],score:38},{match:["supports defined","growing coordination"],score:63},{match:["fully aligned","driving outcomes"],score:88}]},
  {key:"ai_adoption",section:"air",weight:0.25,question:"What stage is your organisation at in adopting AI tools",type:"influencer",
    positives:[{match:["piloted in specific teams","being piloted"],points:1},{match:["repeatable decisions"],points:1},{match:["embedded in regular workflows"],points:1},{match:["used at scale","influence key decisions"],points:1},{match:["business impact","measured and reported"],points:1},{match:["driven and sponsored","senior leadership"],points:1}],
    negatives:[{match:["no active use"],points:-3,severity:"High"},{match:["basic","individual experimentation","chatgpt"],points:-1,severity:"Basic"},{match:["confined to siloed","siloed tools"],points:-2,severity:"Intermediate"},{match:["manual, disconnected","without integration"],points:-2,severity:"Intermediate"}]},
  {key:"ai_governance",section:"air",weight:0.25,question:"How well is the use of AI tools",type:"influencer",
    positives:[{match:["initial awareness","awareness of the need"],points:1},{match:["guidance in place"],points:1},{match:["policy exists","reviewed as new capabilities"],points:1},{match:["strong data foundation"],points:1},{match:["governance controls","risks monitored"],points:1},{match:["cross-functional","ai council"],points:1}],
    negatives:[{match:["no policy","no oversight"],points:-3,severity:"High"},{match:["risky use"],points:-3,severity:"High"},{match:["fragmented","conflicting practices"],points:-2,severity:"Intermediate"},{match:["unclear roles","unclear ownership"],points:-1,severity:"Basic"}]},
  {key:"ai_capability",section:"air",weight:0.25,question:"How capable is your organisation in developing, deploying",type:"band",
    mappings:[{match:["no in-house","largely absent","reliant on external"],score:12},{match:["some capability","narrow","not scalable","team-dependent","limited skills","small-scale","experimental projects","small-scale or experimental"],score:38},{match:["deployed and maintained","repeatable processes"],score:63},{match:["consistently develops","at scale","with confidence"],score:88}]},
  {key:"value_impact",section:"va",weight:0.40,question:"What impact has your data and AI capability had",type:"band",
    mappings:[{match:["no measurable impact","unclear","anecdotal","not tracked"],score:10},{match:["some areas show value","inconsistent","not well quantified","limited impact","isolated areas","limited impact in isolated"],score:30},{match:["value visible","specific teams","not yet widespread"],score:50},{match:["delivering recurring impact","multiple areas"],score:70},{match:["high-value outcomes","cost efficiency","growth at scale"],score:90}]},
  {key:"scalability",section:"va",weight:0.30,question:"How well can your data and AI initiatives scale",type:"band",
    mappings:[{match:["cannot scale","isolated","manually managed","no capacity","pilot projects"],score:10},{match:["some reuse","significant effort"],score:30},{match:["platforms improving","moderate effort"],score:50},{match:["reasonable efficiency","alignment to business"],score:70},{match:["fast, reliable scaling","governance support","highly scalable","rapid business growth","supporting rapid business"],score:90}]},
  {key:"speed",section:"va",weight:0.30,question:"How quickly can new data or AI solutions move from idea",type:"band",
    mappings:[{match:["very slow","years to implement","major delays","blockers","rarely delivered"],score:10},{match:["some ideas","inconsistent","heavily manual"],score:30},{match:["moderate ability","reactive","resource-limited","months to deliver","take months","projects take months"],score:50},{match:["delivered quickly","processes support speed"],score:70},{match:["consistently moves","agility","idea to implementation with"],score:90}]},
];
