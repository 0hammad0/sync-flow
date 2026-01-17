import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { generateToken, getBaseUrl } from '@/lib/utils';

// POST - Create a new receive session
export async function POST() {
  try {
    const serviceClient = createServiceClient();
    const sessionToken = generateToken();

    const { error } = await serviceClient
      .from('receive_sessions')
      .insert({
        session_token: sessionToken,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
      });

    if (error) {
      console.error('Create receive session error:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to create receive session' },
        { status: 500 }
      );
    }

    const sendUrl = `${getBaseUrl()}/send/${sessionToken}`;

    return NextResponse.json({
      success: true,
      sessionToken,
      sendUrl,
      expiresIn: 600, // 10 minutes in seconds
    });
  } catch (error) {
    console.error('Create receive session error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
