import { Route, Routes } from 'react-router-dom';
import EstimateDetail from './EstimateDetail';
import EstimateEditor from './EstimateEditor';
import { EstimatesList } from './EstimatesList';
import PriceBookScreen from './PriceBookScreen';

export default function EstimatesScreen() {
  return (
    <Routes>
      <Route index element={<EstimatesList />} />
      <Route path="pricebook" element={<PriceBookScreen />} />
      <Route path="new" element={<EstimateEditor />} />
      <Route path=":id" element={<EstimateDetail />} />
      <Route path=":id/edit" element={<EstimateEditor />} />
    </Routes>
  );
}
