import { TraitViews } from '@/components/charts/TraitViews';
import { formatTimeAgo } from '@/utils/format';

interface SoulViewProps {
  soul: {
    persona: string;
    role: string;
    traits: Record<string, number>;
    goals: string[];
    strengths: string[];
    weaknesses: string[];
    learnings: string[];
    version: number;
    lastReflection?: string;
    extraFrontmatter?: Record<string, string>;
    extraSections?: Array<{ heading: string; content: string }>;
  };
}

export function SoulView({ soul }: SoulViewProps) {
  return (
    <div className="space-y-6">
      {/* Header with version + last updated */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Soul Profile</h3>
        <div className="flex items-center gap-2">
          {soul.lastReflection && (
            <span className="text-[10px] text-zinc-500" title={new Date(soul.lastReflection).toLocaleString()}>
              Updated {formatTimeAgo(soul.lastReflection)}
            </span>
          )}
          <span className="text-xs px-2 py-0.5 rounded bg-zinc-700 text-zinc-400">
            v{soul.version}
          </span>
        </div>
      </div>

      {/* Role */}
      {soul.role && (
        <div className="bg-zinc-800/50 rounded-lg px-3 py-2 border border-zinc-700/50">
          <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-0.5">Role</h4>
          <p className="text-sm font-medium text-zinc-200">{soul.role}</p>
        </div>
      )}

      {/* Persona */}
      <div>
        <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Persona</h4>
        <p className="text-sm text-zinc-300 leading-relaxed">{soul.persona}</p>
      </div>

      {/* Traits */}
      {Object.keys(soul.traits).length >= 3 && (
        <TraitViews traits={soul.traits} />
      )}

      {/* Goals */}
      <div>
        <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Goals</h4>
        <ul className="space-y-1">
          {soul.goals.map((goal, i) => (
            <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
              <span className="text-zinc-600 mt-0.5">-</span>
              <span>{goal}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Strengths */}
      <div>
        <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Strengths</h4>
        <ul className="space-y-1">
          {soul.strengths.map((item, i) => (
            <li key={i} className="text-sm text-green-400 flex items-start gap-2">
              <span className="text-green-600 mt-0.5">-</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Weaknesses */}
      <div>
        <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Weaknesses</h4>
        <ul className="space-y-1">
          {soul.weaknesses.map((item, i) => (
            <li key={i} className="text-sm text-red-400 flex items-start gap-2">
              <span className="text-red-600 mt-0.5">-</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Learnings */}
      <div>
        <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Learnings</h4>
        <ul className="space-y-1">
          {soul.learnings.map((item, i) => (
            <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
              <span className="text-zinc-600 mt-0.5">-</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Extra Frontmatter (agent-specific metadata) */}
      {soul.extraFrontmatter && Object.keys(soul.extraFrontmatter).length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Metadata</h4>
          <div className="space-y-1">
            {Object.entries(soul.extraFrontmatter).map(([key, value]) => (
              <div key={key} className="flex items-baseline gap-2 text-sm">
                <span className="text-zinc-500 font-mono text-xs">{key}:</span>
                <span className="text-zinc-300">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Extra Sections (agent-specific custom sections) */}
      {soul.extraSections?.map((section, i) => (
        <div key={i}>
          <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
            {section.heading.replace(/^##\s*/, '')}
          </h4>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
            {section.content.trim()}
          </p>
        </div>
      ))}
    </div>
  );
}
