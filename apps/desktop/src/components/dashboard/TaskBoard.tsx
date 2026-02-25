import { useState, useCallback } from 'react';
import { TaskCard } from '@/components/dashboard/TaskCard';

interface TaskBoardProps {
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    assignedTo?: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    tags: string[];
  }>;
  agents: Record<string, { name: string; color: string }>;
  onUpdateStatus: (taskId: string, status: string) => void;
  onAssign: (taskId: string, agentId: string) => void;
  onDelete: (taskId: string) => void;
  onBulkDelete: (taskIds: string[]) => void;
  onCancel?: (taskId: string) => void;
}

const columns = [
  { key: 'pending', label: 'Pending', droppable: true },
  { key: 'assigned', label: 'Assigned', droppable: true },
  { key: 'running', label: 'Running', droppable: false },
  { key: 'done', label: 'Done', droppable: true },
] as const;

/** Map task status → column key */
function getColumn(status: string): string {
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return 'done';
  return status;
}

/** Map column key → task status for drops */
function columnToStatus(colKey: string): string {
  if (colKey === 'done') return 'completed';
  return colKey;
}

export function TaskBoard({ tasks, agents, onUpdateStatus, onAssign, onDelete, onBulkDelete, onCancel }: TaskBoardProps) {
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const grouped = tasks.reduce<Record<string, typeof tasks>>((acc, task) => {
    const col = getColumn(task.status);
    if (!acc[col]) acc[col] = [];
    acc[col].push(task);
    return acc;
  }, {});

  const doneTaskIds = (grouped['done'] ?? []).map((t) => t.id);

  const handleDragOver = useCallback((e: React.DragEvent, colKey: string, droppable: boolean) => {
    if (!droppable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(colKey);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverCol(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, colKey: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Already in this column
    if (getColumn(task.status) === colKey) return;

    const newStatus = columnToStatus(colKey);
    onUpdateStatus(taskId, newStatus);
  }, [tasks, onUpdateStatus]);

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Task Board</h2>
        <div className="flex items-center gap-2">
          {doneTaskIds.length > 0 && (
            <button
              onClick={() => onBulkDelete(doneTaskIds)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Clear Done ({doneTaskIds.length})
            </button>
          )}
          {tasks.length > 0 && (
            <button
              onClick={() => onBulkDelete(tasks.map((t) => t.id))}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Clear All ({tasks.length})
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 grid grid-cols-4 gap-4 min-h-0">
        {columns.map((col) => {
          const columnTasks = grouped[col.key] ?? [];
          const isOver = dragOverCol === col.key && col.droppable;
          return (
            <div
              key={col.key}
              className="flex flex-col min-h-0"
              onDragOver={(e) => handleDragOver(e, col.key, col.droppable)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => col.droppable ? handleDrop(e, col.key) : undefined}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-zinc-300">{col.label}</h3>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-400">
                  {columnTasks.length}
                </span>
              </div>

              {/* Column body — drop zone */}
              <div className={`flex-1 overflow-y-auto space-y-2 pr-1 rounded-lg transition-colors ${
                isOver ? 'bg-blue-500/10 ring-2 ring-blue-500/30' : ''
              }`}>
                {columnTasks.map((task) => {
                  const agent = task.assignedTo ? agents[task.assignedTo] : undefined;
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      agentName={agent?.name}
                      agentColor={agent?.color}
                      agents={agents}
                      onDelete={onDelete}
                      onCancel={onCancel}
                      onAssign={onAssign}
                    />
                  );
                })}
                {columnTasks.length === 0 && (
                  <div className={`text-xs text-center py-8 border border-dashed rounded-lg ${
                    isOver ? 'border-blue-500/50 text-blue-400' : 'border-zinc-700 text-zinc-600'
                  }`}>
                    {isOver ? 'Drop here' : 'No tasks'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
