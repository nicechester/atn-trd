import { Navigate } from 'react-router-dom';

export default function DataSourcesPage(): JSX.Element {
  return <Navigate to="/settings/data-sources" replace />;
}
