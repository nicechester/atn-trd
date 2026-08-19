import { Navigate } from 'react-router-dom';

export default function LlmTestPage(): JSX.Element {
  return <Navigate to="/settings/llm" replace />;
}
