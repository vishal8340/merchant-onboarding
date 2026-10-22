#!/usr/bin/env ts-node
/**
 * Test AWS Textract Connection
 * Validates that AWS credentials are working and Textract API is accessible
 */

import 'dotenv/config';
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

const USE_AWS_TEXTRACT = process.env.USE_AWS_TEXTRACT === 'true';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';

/** Build a minimal 1×1 white PNG as a Buffer (no external deps) */
function createWhitePng(width = 100, height = 100): Buffer {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buf) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type: string, data: Buffer): Buffer {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcInput = Buffer.concat([typeBytes, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput));
    return Buffer.concat([len, typeBytes, data, crcBuf]);
  }

  // IHDR: width, height, 8-bit depth, RGB colour type 2
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // IDAT: one row per line, each row = filter(0) + width*3 white bytes
  const row = Buffer.alloc(1 + width * 3, 0xff); // filter=0xFF then white pixels
  row[0] = 0; // filter byte = 0 (None)
  const rawRows = Buffer.concat(Array(height).fill(row));

  // deflate with zlib
  const zlib = require('zlib');
  const idatData = zlib.deflateSync(rawRows);

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', iend),
  ]);
}

async function testAwsCredentials(): Promise<boolean> {
  console.log('='.repeat(60));
  console.log('AWS TEXTRACT CONNECTION TEST');
  console.log('='.repeat(60));
  console.log();

  // --- Configuration check ---
  console.log('📋 Configuration Check:');
  console.log(`   USE_AWS_TEXTRACT: ${USE_AWS_TEXTRACT}`);
  console.log(`   AWS_REGION: ${AWS_REGION}`);
  if (AWS_ACCESS_KEY_ID) {
    console.log(`   AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID.slice(0, 10)}...`);
  } else {
    console.log('   AWS_ACCESS_KEY_ID: Not set');
  }
  console.log(`   AWS_SECRET_ACCESS_KEY: ${'*'.repeat(20)} (hidden)`);
  console.log();

  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    console.log('❌ ERROR: AWS credentials not configured in .env file');
    return false;
  }

  const clientConfig = {
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
  };

  // --- STS identity check ---
  console.log('🔗 Testing AWS Connection...');
  try {
    const stsClient = new STSClient(clientConfig);
    const identity = await stsClient.send(new GetCallerIdentityCommand({}));

    console.log('✅ AWS Credentials Valid!');
    console.log(`   Account ID: ${identity.Account}`);
    console.log(`   User ARN:   ${identity.Arn}`);
    console.log();

    // --- Textract API check ---
    console.log('🔍 Testing Textract API Access...');

    const imageBytes = createWhitePng(100, 100);

    const textractClient = new TextractClient(clientConfig);
    const response = await textractClient.send(
      new DetectDocumentTextCommand({
        Document: { Bytes: imageBytes },
      })
    );

    console.log('✅ AWS Textract API Accessible!');
    console.log('   Response Status: Success');
    console.log(`   Blocks Detected: ${(response.Blocks ?? []).length}`);
    console.log();

    // --- Cost info ---
    console.log('💰 Cost Information:');
    console.log('   DetectDocumentText: $0.0015 per page');
    console.log('   AnalyzeDocument (Forms): $0.065 per page');
    console.log('   Free Tier: 1,000 pages/month for first 3 months');
    console.log();

    console.log('='.repeat(60));
    console.log('✅ ALL TESTS PASSED - AWS Textract is ready to use!');
    console.log('='.repeat(60));
    return true;

  } catch (err: any) {
    const code: string = err?.name ?? err?.Code ?? '';
    const message: string = err?.message ?? '';

    if (code === 'CredentialsProviderError' || code === 'NoCredentialsError') {
      console.log('❌ ERROR: No AWS credentials found');
      console.log('   Please check your .env file');
    } else if (code === 'InvalidClientTokenId') {
      console.log('❌ ERROR: Invalid AWS Access Key ID');
      console.log('   The Access Key ID is not recognized by AWS');
      console.log('   Please verify your AWS_ACCESS_KEY_ID in .env file');
    } else if (code === 'SignatureDoesNotMatch') {
      console.log('❌ ERROR: Invalid AWS Secret Access Key');
      console.log('   The Secret Access Key does not match');
      console.log('   Please verify your AWS_SECRET_ACCESS_KEY in .env file');
    } else if (code === 'AccessDenied' || code === 'UnauthorizedOperation') {
      console.log('❌ ERROR: Access Denied');
      console.log("   Your AWS credentials don't have Textract permissions");
      console.log("   Please add 'AmazonTextractFullAccess' policy to your IAM user");
    } else {
      console.log(`❌ ERROR: ${code || 'UnknownError'}`);
      console.log(`   ${message}`);
    }

    console.log();
    console.log('📖 Check your .env file and IAM permissions for setup help');
    return false;
  }
}

testAwsCredentials().then((ok) => process.exit(ok ? 0 : 1));
