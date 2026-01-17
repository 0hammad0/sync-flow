'use client';

import { UploadStage } from '@/types';

interface ProgressBarProps {
  stage: UploadStage;
  percent: number;
  className?: string;
}

const stageConfig: Record<UploadStage, { label: string; color: string }> = {
  idle: { label: 'Ready', color: 'bg-gray-300' },
  preparing: { label: 'Preparing...', color: 'bg-yellow-500' },
  encrypting: { label: 'Encrypting...', color: 'bg-purple-500' },
  uploading: { label: 'Uploading...', color: 'bg-blue-500' },
  completed: { label: 'Complete', color: 'bg-green-500' },
  error: { label: 'Error', color: 'bg-red-500' },
};

export default function ProgressBar({ stage, percent, className = '' }: ProgressBarProps) {
  const { label, color } = stageConfig[stage];
  const isActive = stage === 'preparing' || stage === 'encrypting' || stage === 'uploading';

  return (
    <div className={`w-full ${className}`}>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs sm:text-sm font-medium text-gray-700">{label}</span>
        <span className="text-xs sm:text-sm font-medium text-gray-500">{Math.round(percent)}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2 sm:h-2.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${color} ${
            isActive ? 'animate-pulse-subtle' : ''
          }`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}
