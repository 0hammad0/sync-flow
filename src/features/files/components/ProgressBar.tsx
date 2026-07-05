'use client';

import { UploadStage } from '@/types';

interface ProgressBarProps {
  stage: UploadStage;
  percent: number;
  className?: string;
}

const stageConfig: Record<UploadStage, { label: string; barClass: string }> = {
  idle: { label: 'Ready', barClass: 'bg-surface-3' },
  preparing: { label: 'Preparing...', barClass: 'bg-flow' },
  encrypting: { label: 'Encrypting...', barClass: 'bg-flow-tri' },
  uploading: { label: 'Uploading...', barClass: 'bg-flow' },
  completed: { label: 'Complete', barClass: 'bg-success' },
  error: { label: 'Error', barClass: 'bg-danger' },
};

export default function ProgressBar({ stage, percent, className = '' }: ProgressBarProps) {
  const { label, barClass } = stageConfig[stage];
  const isActive = stage === 'preparing' || stage === 'encrypting' || stage === 'uploading';

  return (
    <div className={`w-full ${className}`}>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs sm:text-sm font-medium text-fg">{label}</span>
        <span className="text-xs sm:text-sm font-medium text-fg-muted tabular-nums">
          {Math.round(percent)}%
        </span>
      </div>
      <div className="w-full bg-surface-3 rounded-full h-2 sm:h-2.5 overflow-hidden">
        <div
          className={`relative h-full rounded-full transition-all duration-300 ease-out overflow-hidden ${barClass} ${
            isActive ? 'progress-shimmer' : ''
          }`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}
