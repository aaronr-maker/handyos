import { Link, Route, Routes } from 'react-router-dom';
import { ModulePlaceholder } from '@/core';
import PriceBookScreen from './PriceBookScreen';

function EstimatesHome() {
  return (
    <>
      <ModulePlaceholder
        title="Estimates"
        icon="estimates"
        summary="Quotes your customers can approve."
        planned={['Build and send estimates from a phone', 'Customer approval turns into a job automatically', 'Billed to the manager, owed by the owner']}
      />
      <p>
        <Link to="pricebook" className="button">
          Open the price book
        </Link>
      </p>
    </>
  );
}

export default function EstimatesScreen() {
  return (
    <Routes>
      <Route index element={<EstimatesHome />} />
      <Route path="pricebook" element={<PriceBookScreen />} />
    </Routes>
  );
}
