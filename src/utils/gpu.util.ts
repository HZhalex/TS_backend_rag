import { execSync } from 'child_process';
import * as os from 'os';
import { Logger } from '@nestjs/common';

export interface GpuInfo {
  hasGpu: boolean;
  type: 'cuda' | 'metal' | 'vulkan' | 'cpu';
  platform: string;
  arch: string;
  details: string;
  nodeLlamaGpuOption: 'auto' | 'cuda' | 'metal' | 'vulkan' | false;
}

const logger = new Logger('GpuDetector');

/**
 * Detect GPU capabilities across Windows (NVIDIA CUDA), macOS (Apple Silicon Metal/MPS), and Linux.
 */
export function detectGpu(): GpuInfo {
  const platform = os.platform();
  const arch = os.arch();

  // 1. Apple Silicon (macOS Metal / MPS)
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      logger.log('Detected Apple Silicon (M-series). Enabling Metal GPU acceleration.');
      return {
        hasGpu: true,
        type: 'metal',
        platform,
        arch,
        details: 'Apple Silicon Metal/MPS GPU Acceleration',
        nodeLlamaGpuOption: 'metal',
      };
    } else {
      logger.log('Detected Intel Mac. Checking for external GPU or fallback to CPU.');
      return {
        hasGpu: false,
        type: 'cpu',
        platform,
        arch,
        details: 'Intel Mac - CPU fallback',
        nodeLlamaGpuOption: 'auto',
      };
    }
  }

  // 2. Windows or Linux: Check for NVIDIA CUDA
  if (platform === 'win32' || platform === 'linux') {
    try {
      const output = execSync('nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 3000,
      }).trim();

      if (output && output.length > 0) {
        logger.log(`Detected NVIDIA GPU via nvidia-smi: ${output}. Enabling CUDA.`);
        return {
          hasGpu: true,
          type: 'cuda',
          platform,
          arch,
          details: `NVIDIA CUDA (${output})`,
          nodeLlamaGpuOption: 'cuda',
        };
      }
    } catch {
      // nvidia-smi failed or not installed
    }
  }

  // 3. Fallback: let node-llama-cpp try auto-detection or CPU
  logger.warn('No dedicated NVIDIA CUDA or Apple Metal GPU detected. Defaulting to auto/CPU.');
  return {
    hasGpu: false,
    type: 'cpu',
    platform,
    arch,
    details: 'CPU Only (No dedicated CUDA/Metal detected)',
    nodeLlamaGpuOption: 'auto',
  };
}
