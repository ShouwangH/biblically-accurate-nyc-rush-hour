/**
 * LoadingScreen Component
 *
 * Displays a loading indicator while simulation data is being fetched.
 * Designed to be readable on projector displays.
 */

interface LoadingScreenProps {
  /** Optional loading message to display */
  message?: string;
}

/**
 * Full-screen loading indicator shown while data loads.
 *
 * Usage:
 * ```tsx
 * const { isLoading, error } = useData();
 * if (isLoading) return <LoadingScreen />;
 * if (error) return <LoadingScreen message={error.message} />;
 * ```
 */
export function LoadingScreen({ message = 'Loading simulation data...' }: LoadingScreenProps) {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F5F5F0', // Match Environment background
        color: '#333',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          fontSize: '1.5rem',
          fontWeight: 500,
          marginBottom: '1rem',
        }}
      >
        NYC Rush Hour
      </div>
      <div
        style={{
          fontSize: '1rem',
          color: '#666',
        }}
      >
        {message}
      </div>
      <div
        style={{
          marginTop: '2rem',
          width: '200px',
          height: '4px',
          backgroundColor: '#ddd',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '40%',
            height: '100%',
            backgroundColor: '#0039A6', // Subway blue
            borderRadius: '2px',
            animation: 'loading-slide 1.5s ease-in-out infinite',
          }}
        />
      </div>
      <style>
        {`
          @keyframes loading-slide {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(150%); }
            100% { transform: translateX(-100%); }
          }
        `}
      </style>
    </div>
  );
}
